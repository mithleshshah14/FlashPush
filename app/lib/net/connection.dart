import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../core/errors.dart';
import '../core/laptop_api.dart';
import '../core/models.dart';
import '../core/sse.dart';
import '../data/history_cache.dart';
import '../data/laptop_store.dart';
import 'address_race.dart';
import 'backoff.dart';
import 'link_state.dart';

typedef ApiFactory = LaptopApi Function(String host, int port, Uint8List? pin);

sealed class _Outcome {
  const _Outcome();
}

class _Connected extends _Outcome {
  const _Connected();
}

/// Try again right away (the session had merely expired).
class _Immediate extends _Outcome {
  const _Immediate();
}

/// The laptop cannot be reached now; try again later.
class _Retry extends _Outcome {
  const _Retry([this.after]);
  final Duration? after;
}

/// Retrying can never help: stop and tell the user.
class _Terminal extends _Outcome {
  const _Terminal(this.state);
  final LinkState state;
}

const _maxImmediateRetries = 2;

bool _always() => true;

/// The link between this phone and one paired laptop (docs/connection-state.md).
///
/// It holds a "connect intent": Disconnect clears it, while network loss keeps it and reconnects
/// with backoff. The device secret is only ever sent on a connection pinned to the approved certificate.
class LaptopConnection extends ChangeNotifier {
  LaptopConnection({
    required Laptop laptop,
    required this.deviceId,
    required this.credentials,
    required this.apiFor,
    required this.store,
    required this.cache,
    Future<void> Function(Duration)? wait,
    Backoff? backoff,
    this.autoReconnect = _always,
  })  : _laptop = laptop,
        _wait = wait ?? Future.delayed,
        _backoff = backoff ?? Backoff();

  final String deviceId;
  final Credentials credentials;
  final ApiFactory apiFor;
  final LaptopStore store;
  final HistoryCache cache;
  final Future<void> Function(Duration) _wait;
  final Backoff _backoff;

  /// When off, one attempt is made and a failure is not retried.
  final bool Function() autoReconnect;

  Laptop _laptop;
  LinkState _state = LinkState.paired;
  RouteKind _route = RouteKind.none;
  List<Item> _items = const [];
  bool _intent = false;
  bool _foreground = true;
  bool _disposed = false;
  int _generation = 0; // bumped to abandon a running connect loop or event stream
  LaptopApi? _api;
  String? _token;
  StreamSubscription<SseEvent>? _events;
  final _incomingController = StreamController<Item>.broadcast();

  Laptop get laptop => _laptop;
  LinkState get state => _state;
  RouteKind get route => _route;
  List<Item> get items => List.unmodifiable(_items);
  bool get connected => _state == LinkState.connected;

  /// Text, image and file items as they arrive live from the laptop (not the initial history load).
  /// For an in-app "X sent you a message" banner; nothing listens while the app is backgrounded, since
  /// the connection itself is foreground-only (see setForeground).
  Stream<Item> get incoming => _incomingController.stream;

  /// Wi-Fi icon: reaching the laptop over the local network.
  bool get wifiUp => connected && _route == RouteKind.wifi;

  void _set(LinkState state) {
    if (_disposed) return;
    _state = state;
    notifyListeners();
  }

  /// Shows what was cached from earlier sessions, so history is readable offline.
  Future<void> loadCached() async {
    _items = await cache.load(_laptop.id);
    if (!_disposed) notifyListeners();
  }

  // ---- connecting -------------------------------------------------------------

  /// Sets the connect intent and connects. Completes when connected, on a terminal problem, or when
  /// paused in the background. While the laptop is unreachable it keeps retrying with backoff.
  Future<void> connect() {
    _intent = true;
    return _loop(++_generation);
  }

  Future<void> _loop(int generation) async {
    var immediate = 0;
    while (_intent && generation == _generation && !_disposed) {
      if (!_foreground) {
        _set(LinkState.unreachable); // paused; setForeground(true) resumes
        return;
      }
      _set(LinkState.connecting);
      var outcome = await _attempt(generation);
      if (generation != _generation) return;
      if (outcome is _Immediate && ++immediate > _maxImmediateRetries) outcome = const _Retry();
      switch (outcome) {
        case _Connected():
          _backoff.reset();
          return;
        case _Terminal(:final state):
          _intent = false;
          _set(state);
          return;
        case _Immediate():
          continue;
        case _Retry(:final after):
          _set(LinkState.unreachable);
          if (!autoReconnect()) {
            _intent = false;
            return;
          }
          await _wait(after ?? _backoff.next());
      }
    }
  }

  /// Saved addresses, the last verified one first.
  List<LaptopAddress> _candidates() {
    final all = _laptop.addresses;
    return [
      ...all.where((a) => a.host == _laptop.lastHost),
      ...all.where((a) => a.host != _laptop.lastHost),
    ];
  }

  Future<_Outcome> _attempt(int generation) async {
    var certificateRefused = false;
    final winner = await raceAddresses<LaptopAddress, LaptopApi>(_candidates(), (address, cancel) async {
      final api = apiFor(address.host, address.port, credentials.fingerprint);
      cancel.onCancel(api.close);
      try {
        final hello = await api.hello();
        if (hello.laptopId != _laptop.id) throw const Unreachable(); // another laptop answers at this address
        return api;
      } on CertificateChanged {
        certificateRefused = true;
        api.close();
        rethrow;
      } on Object {
        api.close();
        rethrow;
      }
    });
    if (winner == null) return certificateRefused ? const _Terminal(LinkState.certChanged) : const _Retry();

    final api = winner.value;
    if (generation != _generation) {
      api.close();
      return const _Retry();
    }
    try {
      final session = await api.connect(deviceId: deviceId, secret: credentials.secret);
      _api = api;
      _token = session.token;
      _route = winner.candidate.isTailscale ? RouteKind.tailscale : RouteKind.wifi;
      await _remember(session.addresses, winner.candidate);
      // Listen before fetching: the laptop does not replay events, so the other order could miss one.
      _listen(generation, api, session.token);
      await _fetchItems(api, session.token);
      if (generation != _generation) {
        _dropSession();
        return const _Retry();
      }
      _set(LinkState.connected);
      return const _Connected();
    } on Object catch (error) {
      await _events?.cancel(); // before closing the client, so its end is not mistaken for a lost link
      _events = null;
      _dropSession();
      api.close();
      return _classify(error);
    }
  }

  _Outcome _classify(Object error) {
    if (error is CertificateChanged) return const _Terminal(LinkState.certChanged);
    if (error is ApiException) {
      switch (error.code) {
        case 'DEVICE_NOT_PAIRED':
        case 'UNAUTHORIZED':
          return const _Terminal(LinkState.unpaired);
        case 'SESSION_EXPIRED':
          return const _Immediate();
        case 'RATE_LIMITED':
          return _Retry(error.retryAfter);
      }
    }
    return const _Retry();
  }

  /// Refreshes the saved addresses after every successful connect; manual ones are kept.
  /// Learns an address the laptop was discovered at, so later connects can use it.
  Future<void> learnAddress(LaptopAddress address) async {
    if (_laptop.addresses.contains(address)) return;
    _laptop = _laptop.copyWith(addresses: [..._laptop.addresses, address]);
    await store.save(_laptop);
  }

  Future<void> _remember(List<LaptopAddress> fresh, LaptopAddress used) async {
    final manual = _laptop.addresses.where((a) => a.kind == 'manual' && !fresh.contains(a));
    _laptop = _laptop.copyWith(addresses: [...fresh, ...manual], lastHost: used.host);
    await store.save(_laptop);
  }

  Future<void> _fetchItems(LaptopApi api, String token) async {
    final fetched = await api.items(token);
    fetched.sort((a, b) => a.time.compareTo(b.time));
    _items = fetched;
    await cache.save(_laptop.id, _items);
  }

  void _dropSession() {
    _api = null;
    _token = null;
    _route = RouteKind.none;
  }

  // ---- live events ------------------------------------------------------------

  void _listen(int generation, LaptopApi api, String token) {
    _events?.cancel();
    _events = api.events(token).listen(
      (event) => _onEvent(generation, event),
      onError: (Object error) => _onLost(generation, error),
      onDone: () => _onLost(generation, null),
    );
  }

  void _onEvent(int generation, SseEvent event) {
    if (generation != _generation || _disposed) return;
    switch (event.event) {
      case 'item-added':
        final item = Item.fromJson(event.data);
        if (_items.every((i) => i.id != item.id)) {
          _items = [..._items, item];
          if (item.fromLaptop) _incomingController.add(item);
        }
      case 'item-deleted':
        _items = _items.where((i) => i.id != event.data['id']).toList();
      case 'expired':
        _sessionEnded(event.data['reason'] as String?);
        return;
      default:
        return;
    }
    unawaited(cache.save(_laptop.id, _items));
    notifyListeners();
  }

  void _sessionEnded(String? reason) {
    _events?.cancel();
    _dropSession();
    if (reason == 'revoked') {
      _generation++;
      _intent = false;
      _set(LinkState.unpaired);
    } else if (_intent) {
      unawaited(connect()); // replaced or expired: the device secret gets a new session
    }
  }

  /// The event stream ended without our doing: the link is dead. Keep the intent and reconnect.
  void _onLost(int generation, Object? error) {
    if (generation != _generation || _disposed || !_intent) return;
    _events?.cancel();
    _dropSession();
    if (error is CertificateChanged) {
      _intent = false;
      _set(LinkState.certChanged);
    } else if (_foreground) {
      unawaited(connect());
    } else {
      _set(LinkState.unreachable);
    }
  }

  // ---- other actions ------------------------------------------------------------

  /// Ends the connection and clears the intent, so nothing reconnects until the user asks.
  Future<void> disconnect() async {
    _intent = false;
    _generation++;
    await _events?.cancel();
    _events = null;
    final api = _api;
    final token = _token;
    _dropSession();
    _set(LinkState.disconnecting);
    if (api != null && token != null) {
      try {
        await api.disconnect(token);
      } on Object {
        // The laptop may be gone already; the session expires on its own.
      }
    }
    api?.close();
    _set(LinkState.paired);
  }

  /// Forget this laptop: tell it (best effort), then wipe everything stored here.
  Future<void> forget() async {
    final api = _api;
    final token = _token;
    _intent = false;
    _generation++;
    await _events?.cancel();
    _events = null;
    _dropSession();
    if (api != null && token != null) {
      try {
        await api.forget(token);
      } on Object {
        // Local forgetting is what matters; the laptop can also revoke this phone.
      }
    }
    api?.close();
    await store.remove(_laptop.id);
    await cache.clear(_laptop.id);
    _items = const [];
    _set(LinkState.notPaired);
  }

  /// Foreground only: pausing closes the event stream; resuming reconnects or refetches.
  Future<void> setForeground(bool foreground) async {
    if (_foreground == foreground) return;
    _foreground = foreground;
    if (!foreground) {
      await _events?.cancel();
      _events = null;
      return;
    }
    if (!_intent) return;
    if (connected) {
      await refreshItems();
    } else if (_state == LinkState.unreachable) {
      await connect();
    }
  }

  /// Refetches the list (no event replay exists) and reopens the event stream.
  Future<void> refreshItems() async {
    final api = _api;
    final token = _token;
    if (api == null || token == null) return;
    try {
      await _fetchItems(api, token);
      notifyListeners();
      _listen(_generation, api, token);
    } on Object catch (error) {
      _onLost(_generation, error is ApiException && error.code == 'SESSION_EXPIRED' ? null : error);
    }
  }

  final Map<String, Future<File?>> _imageJobs = {};

  /// The cached copy of an image; downloaded once when connected, null when it is not available.
  Future<File?> imageFile(Item item) {
    final cached = cache.imageFile(_laptop.id, item.id);
    if (cached.existsSync()) return Future.value(cached);
    if (!connected) return Future.value();
    return _imageJobs[item.id] ??= _download(item).whenComplete(() {
      _imageJobs.remove(item.id); // a block body: returning the future itself would make it wait on itself
    });
  }

  Future<File?> _download(Item item) async {
    try {
      final temp = await withSession((api, token) async => api.download(token, item, await cache.scratch()));
      final stored = await cache.storeImage(_laptop.id, item.id, temp);
      await temp.delete();
      return stored;
    } on Object {
      return null; // the grid shows a placeholder; opening the image again retries
    }
  }

  /// Runs [action] on the live session. If the session turns out to have expired, reconnects and retries once.
  Future<T> withSession<T>(Future<T> Function(LaptopApi api, String token) action) async {
    for (var attempt = 0;; attempt++) {
      final api = _api;
      final token = _token;
      if (!connected || api == null || token == null) throw const NotConnected();
      try {
        return await action(api, token);
      } on ApiException catch (error) {
        if (error.code != 'SESSION_EXPIRED' || attempt > 0) rethrow;
        await connect();
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _events?.cancel();
    _api?.close();
    unawaited(_incomingController.close());
    super.dispose();
  }
}
