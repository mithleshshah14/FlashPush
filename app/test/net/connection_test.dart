import 'dart:io';
import 'dart:typed_data';

import 'package:flashpush/core/errors.dart';
import 'package:flashpush/core/models.dart';
import 'package:flashpush/data/history_cache.dart';
import 'package:flashpush/data/laptop_store.dart';
import 'package:flashpush/data/secret_store.dart';
import 'package:flashpush/net/connection.dart';
import 'package:flashpush/net/link_state.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_laptop_api.dart';

const lan = LaptopAddress(host: '192.168.1.6', port: 8765, kind: 'lan');
const tailscale = LaptopAddress(host: '100.101.102.103', port: 8765, kind: 'tailscale');
const defaultLaptop = Laptop(id: 'laptop-1', name: 'MITHLESH-PC', addresses: [lan, tailscale]);

ApiException apiError(String code, {Duration? retryAfter}) => ApiException(code, 401, code, retryAfter: retryAfter);

class Harness {
  Harness(this.network, this.connection, this.store, this.cache, this.waits);

  final FakeNetwork network;
  final LaptopConnection connection;
  final LaptopStore store;
  final HistoryCache cache;
  final List<Duration> waits;
}

/// [onWait] runs whenever the connection waits before a retry (the wait itself is instant).
Future<Harness> harness({Laptop laptop = defaultLaptop, FakeNetwork? network, Future<void> Function(Duration)? onWait}) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final store = LaptopStore(prefs, MemorySecretStore());
  await store.save(laptop);
  final dir = await Directory.systemTemp.createTemp('flashpush-conn-');
  addTearDown(() => dir.delete(recursive: true));
  final cache = HistoryCache(dir);
  final net = network ?? (FakeNetwork()..items = [FakeNetwork().textItem('one')]);
  final waits = <Duration>[];
  final connection = LaptopConnection(
    laptop: laptop,
    deviceId: 'device-1',
    credentials: Credentials(secret: 'secret', fingerprint: Uint8List(32)),
    apiFor: net.apiFor,
    store: store,
    cache: cache,
    wait: (d) async {
      waits.add(d);
      await onWait?.call(d);
    },
  );
  addTearDown(connection.dispose);
  return Harness(net, connection, store, cache, waits);
}

void main() {
  test('connects over Wi-Fi, loads and caches the history, and remembers the verified address', () async {
    final h = await harness();
    await h.connection.connect();
    expect(h.connection.state, LinkState.connected);
    expect(h.connection.route, RouteKind.wifi);
    expect(h.connection.wifiUp, isTrue);
    expect(h.connection.items.map((i) => i.id), ['one']);
    expect((await h.cache.load('laptop-1')).map((i) => i.id), ['one']);
    expect(h.store.laptop('laptop-1')!.lastHost, '192.168.1.6');
    expect(h.network.eventsOpened, 1);
  });

  test('over Tailscale the Wi-Fi indicator stays off while the link is on', () async {
    final h = await harness();
    h.network.unreachableHosts.add('192.168.1.6');
    h.network.sessionAddresses = const [tailscale];
    await h.connection.connect();
    expect(h.connection.state, LinkState.connected);
    expect(h.connection.route, RouteKind.tailscale);
    expect(h.connection.wifiUp, isFalse);
  });

  test('one dead address does not stop the connection, and the losing connection is closed', () async {
    final h = await harness();
    h.network.unreachableHosts.add('100.101.102.103');
    await h.connection.connect();
    expect(h.connection.connected, isTrue);
    expect(h.network.apis.where((a) => a.host == '100.101.102.103').every((a) => a.closed), isTrue);
  });

  test('addresses are refreshed from the laptop after each connect; manual ones are kept', () async {
    const manual = LaptopAddress(host: 'my-laptop.tail.ts.net', port: 8765, kind: 'manual');
    final h = await harness(laptop: defaultLaptop.copyWith(addresses: [lan, manual]));
    h.network.unreachableHosts.add('my-laptop.tail.ts.net');
    h.network.sessionAddresses = const [LaptopAddress(host: '192.168.1.7', port: 8765, kind: 'lan')];
    await h.connection.connect();
    expect(h.connection.laptop.addresses.map((a) => a.host), ['192.168.1.7', 'my-laptop.tail.ts.net']);
    expect(h.store.laptop('laptop-1')!.addresses.length, 2);
  });

  test('an address that answers as another laptop never receives the secret', () async {
    final network = FakeNetwork()..laptopId = 'someone-else';
    late Harness h;
    h = await harness(network: network, onWait: (d) => h.connection.disconnect());
    await h.connection.connect();
    expect(network.connectCalls, 0);
  });

  test('disconnect ends the session, clears the intent and a dead stream does not reconnect', () async {
    final h = await harness();
    await h.connection.connect();
    await h.connection.disconnect();
    expect(h.connection.state, LinkState.paired);
    expect(h.network.disconnected, ['token-1']);
    expect(h.connection.route, RouteKind.none);
    await h.network.events!.close();
    await Future<void>.delayed(Duration.zero);
    expect(h.connection.state, LinkState.paired);
    expect(h.network.connectCalls, 1);
  });

  test('network loss keeps the intent and retries after 2 s, 4 s, 8 s', () async {
    final network = FakeNetwork()..items = [FakeNetwork().textItem('one')];
    network.unreachableHosts.addAll(['192.168.1.6', '100.101.102.103']);
    late Harness h;
    h = await harness(network: network, onWait: (d) async {
      if (h.waits.length == 3) network.unreachableHosts.clear();
    });
    await h.connection.connect();
    expect(h.waits, [const Duration(seconds: 2), const Duration(seconds: 4), const Duration(seconds: 8)]);
    expect(h.connection.state, LinkState.connected);
  });

  test('pausing in the background stops retries; resuming connects at once', () async {
    final network = FakeNetwork()..items = [FakeNetwork().textItem('one')];
    network.unreachableHosts.addAll(['192.168.1.6', '100.101.102.103']);
    late Harness h;
    h = await harness(network: network, onWait: (d) => h.connection.setForeground(false));
    await h.connection.connect();
    expect(h.connection.state, LinkState.unreachable);
    expect(h.waits.length, 1);
    network.unreachableHosts.clear();
    await h.connection.setForeground(true);
    expect(h.connection.state, LinkState.connected);
  });

  test('an expired session reconnects at once, without waiting', () async {
    final h = await harness();
    h.network.connectScript.add(apiError('SESSION_EXPIRED'));
    await h.connection.connect();
    expect(h.connection.connected, isTrue);
    expect(h.waits, isEmpty);
    expect(h.network.connectCalls, 2);
  });

  test('a laptop that does not know this phone stops everything: unpaired, no retries', () async {
    for (final code in ['DEVICE_NOT_PAIRED', 'UNAUTHORIZED']) {
      final h = await harness();
      h.network.connectScript.add(apiError(code));
      await h.connection.connect();
      expect(h.connection.state, LinkState.unpaired, reason: code);
      expect(h.network.connectCalls, 1);
      expect(h.waits, isEmpty);
    }
  });

  test('a changed certificate stops everything and the secret is never sent', () async {
    final h = await harness();
    h.network.wrongCertificateHosts.addAll(['192.168.1.6', '100.101.102.103']);
    await h.connection.connect();
    expect(h.connection.state, LinkState.certChanged);
    expect(h.network.connectCalls, 0);
    expect(h.waits, isEmpty);
  });

  test('a rate-limited laptop is retried after the time it asks for', () async {
    final h = await harness();
    h.network.connectScript.add(apiError('RATE_LIMITED', retryAfter: const Duration(seconds: 7)));
    await h.connection.connect();
    expect(h.waits, [const Duration(seconds: 7)]);
    expect(h.connection.connected, isTrue);
  });

  test('live events add and remove items and update the cache', () async {
    final h = await harness();
    await h.connection.connect();
    h.network.emit('item-added', h.network.textItem('two').toJson());
    h.network.emit('item-added', h.network.textItem('two').toJson()); // duplicates are ignored
    await Future<void>.delayed(Duration.zero);
    expect(h.connection.items.map((i) => i.id), ['one', 'two']);
    h.network.emit('item-deleted', {'id': 'one'});
    await Future<void>.delayed(Duration.zero);
    expect(h.connection.items.map((i) => i.id), ['two']);
    await Future<void>.delayed(const Duration(milliseconds: 50)); // the cache is written in the background
    expect((await h.cache.load('laptop-1')).map((i) => i.id), ['two']);
  });

  test('a revoked session ends the connection as unpaired without reconnecting', () async {
    final h = await harness();
    await h.connection.connect();
    h.network.emit('expired', {'reason': 'revoked'});
    await Future<void>.delayed(Duration.zero);
    expect(h.connection.state, LinkState.unpaired);
    expect(h.network.connectCalls, 1);
  });

  test('a session that expired or was replaced reconnects immediately', () async {
    final h = await harness();
    await h.connection.connect();
    h.network.emit('expired', {'reason': 'expired'});
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(h.connection.connected, isTrue);
    expect(h.network.connectCalls, 2);
  });

  test('a dead event stream keeps the intent and reconnects', () async {
    final h = await harness();
    await h.connection.connect();
    await h.network.events!.close();
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(h.connection.connected, isTrue);
    expect(h.network.connectCalls, 2);
  });

  test('resuming while connected refetches the list and reopens the stream', () async {
    final h = await harness();
    await h.connection.connect();
    await h.connection.setForeground(false);
    h.network.items = [h.network.textItem('one'), h.network.textItem('missed')];
    await h.connection.setForeground(true);
    expect(h.connection.items.map((i) => i.id), ['one', 'missed']);
    expect(h.network.eventsOpened, 2);
  });

  test('withSession runs on the live session and refuses when not connected', () async {
    final h = await harness();
    await expectLater(h.connection.withSession((api, token) async => token), throwsA(isA<NotConnected>()));
    await h.connection.connect();
    expect(await h.connection.withSession((api, token) async => token), 'token-1');
  });

  test('withSession reconnects and retries once when the session had expired', () async {
    final h = await harness();
    await h.connection.connect();
    var calls = 0;
    final result = await h.connection.withSession((api, token) async {
      if (++calls == 1) throw apiError('SESSION_EXPIRED');
      return token;
    });
    expect(result, 'token-2');
  });

  test('forget tells the laptop and wipes the laptop, its credentials and its history', () async {
    final h = await harness();
    await h.connection.connect();
    await h.connection.forget();
    expect(h.network.forgotten, ['token-1']);
    expect(h.store.laptops, isEmpty);
    expect(await h.cache.load('laptop-1'), isEmpty);
    expect(h.connection.state, LinkState.notPaired);
  });
}
