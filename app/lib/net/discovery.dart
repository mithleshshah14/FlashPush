import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../core/models.dart';

const discoveryPort = 8766;
const _maxDatagram = 512;
const _maxResults = 20;
final _probe = utf8.encode(jsonEncode({'t': 'FLASHPUSH_DISCOVER', 'v': 1}));

/// Broadcast addresses to probe: the global broadcast plus x.y.z.255 for each of this phone's
/// IPv4 addresses (Dart does not expose netmasks, so a /24 is assumed; add-by-address covers the rest).
Future<List<InternetAddress>> defaultBroadcastTargets() async {
  final targets = <String>{'255.255.255.255'};
  for (final nic in await NetworkInterface.list(type: InternetAddressType.IPv4)) {
    for (final address in nic.addresses) {
      final parts = address.address.split('.');
      targets.add('${parts[0]}.${parts[1]}.${parts[2]}.255');
    }
  }
  return [for (final t in targets) InternetAddress(t)];
}

DiscoveredLaptop? _parseReply(List<int> data, String host) {
  if (data.length > _maxDatagram) return null;
  try {
    final json = jsonDecode(utf8.decode(data));
    if (json is! Map<String, dynamic> || json['t'] != 'FLASHPUSH_HERE' || json['v'] != 1) return null;
    final id = json['laptopId'];
    final name = json['name'];
    final port = json['port'];
    if (id is! String || name is! String || port is! int || port < 1 || port > 65535) return null;
    return DiscoveredLaptop(laptopId: id, name: name, host: host, port: port);
  } on FormatException {
    return null;
  }
}

/// One UDP broadcast scan. Replies are hints only: trust comes later from pairing and pinning.
Future<List<DiscoveredLaptop>> scanForLaptops({
  List<InternetAddress>? targets,
  int port = discoveryPort,
  Duration window = const Duration(seconds: 2),
  InternetAddress? bindAddress,
}) async {
  final socket = await RawDatagramSocket.bind(bindAddress ?? InternetAddress.anyIPv4, 0);
  try {
    socket.broadcastEnabled = true;
    final found = <String, DiscoveredLaptop>{};
    final done = Completer<void>();
    socket.listen((event) {
      if (event != RawSocketEvent.read) return;
      final datagram = socket.receive();
      if (datagram == null || found.length >= _maxResults) return;
      final laptop = _parseReply(datagram.data, datagram.address.address);
      if (laptop != null) found[laptop.laptopId] = laptop;
    });
    for (final target in targets ?? await defaultBroadcastTargets()) {
      socket.send(_probe, target, port);
    }
    Timer(window, done.complete);
    await done.future;
    return found.values.toList();
  } finally {
    socket.close();
  }
}

/// Runs scans by the policy: now, then after 3 s, 6 s and 12 s while nothing has been found.
/// Nothing runs while stopped (the Devices screen is not visible).
class DiscoveryController extends ChangeNotifier {
  DiscoveryController(this._scan, {Future<void> Function(Duration)? wait, this.retryDelays = const [Duration(seconds: 3), Duration(seconds: 6), Duration(seconds: 12)]})
      : _wait = wait ?? Future.delayed;

  final Future<List<DiscoveredLaptop>> Function() _scan;
  final Future<void> Function(Duration) _wait;
  final List<Duration> retryDelays;

  final Map<String, DiscoveredLaptop> _found = {};
  int _run = 0;
  bool _scanning = false;

  List<DiscoveredLaptop> get results => _found.values.toList();
  bool get scanning => _scanning;

  /// Starts the policy run. The returned future completes when the run ends (used by tests).
  Future<void> start() async {
    final run = ++_run;
    await _scanOnce(run);
    for (final delay in retryDelays) {
      if (_found.isNotEmpty) return;
      await _wait(delay);
      if (run != _run) return;
      await _scanOnce(run);
    }
  }

  void stop() => _run++;

  /// Pull-to-refresh: forget what was found and scan again.
  Future<void> scanNow() async {
    final run = ++_run;
    _found.clear();
    await _scanOnce(run);
  }

  Future<void> _scanOnce(int run) async {
    _scanning = true;
    notifyListeners();
    try {
      final laptops = await _scan();
      if (run != _run) return;
      for (final laptop in laptops) {
        _found[laptop.laptopId] = laptop;
      }
    } on Object {
      // A failed scan (no network) is the same as finding nothing.
    } finally {
      _scanning = false;
      notifyListeners();
    }
  }
}
