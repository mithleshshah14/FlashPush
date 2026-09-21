import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flashpush/core/models.dart';
import 'package:flashpush/net/discovery.dart';
import 'package:flutter_test/flutter_test.dart';

/// A UDP responder on loopback that answers every datagram with [reply].
Future<RawDatagramSocket> responder(List<int> Function() reply) async {
  final socket = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
  socket.listen((event) {
    if (event != RawSocketEvent.read) return;
    final datagram = socket.receive();
    if (datagram != null) socket.send(reply(), datagram.address, datagram.port);
  });
  addTearDown(socket.close);
  return socket;
}

List<int> here({String id = 'laptop-1', String name = 'MITHLESH-PC', Object port = 8765, int v = 1}) =>
    utf8.encode(jsonEncode({'t': 'FLASHPUSH_HERE', 'v': v, 'laptopId': id, 'name': name, 'port': port}));

Future<List<DiscoveredLaptop>> scan(RawDatagramSocket server) =>
    scanForLaptops(targets: [InternetAddress.loopbackIPv4], port: server.port, window: const Duration(milliseconds: 200), bindAddress: InternetAddress.loopbackIPv4);

void main() {
  group('scanForLaptops', () {
    test('parses a laptop reply and takes the host from the datagram', () async {
      final laptops = await scan(await responder(() => here()));
      expect(laptops.single.laptopId, 'laptop-1');
      expect(laptops.single.name, 'MITHLESH-PC');
      expect(laptops.single.host, '127.0.0.1');
      expect(laptops.single.port, 8765);
    });

    test('ignores garbage, wrong type or version, bad ports and oversized replies', () async {
      for (final bad in [
        utf8.encode('not json'),
        utf8.encode('{"t":"OTHER","v":1}'),
        here(v: 2),
        here(port: 0),
        here(port: 70000),
        here(port: '8765'),
        here(name: 'x' * 600),
      ]) {
        expect(await scan(await responder(() => bad)), isEmpty);
      }
    });

    test('no reply gives an empty list', () async {
      final silent = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(silent.close);
      expect(await scan(silent), isEmpty);
    });
  });

  group('DiscoveryController policy', () {
    DiscoveredLaptop laptop(String id) => DiscoveredLaptop(laptopId: id, name: id, host: '10.0.0.1', port: 8765);

    test('scans now, then after 3 s, 6 s and 12 s while nothing is found', () async {
      var scans = 0;
      final waits = <Duration>[];
      final controller = DiscoveryController(() async {
        scans++;
        return [];
      }, wait: (d) async => waits.add(d));
      await controller.start();
      expect(scans, 4);
      expect(waits, [const Duration(seconds: 3), const Duration(seconds: 6), const Duration(seconds: 12)]);
    });

    test('stops retrying once a laptop is found', () async {
      var scans = 0;
      final controller = DiscoveryController(() async => ++scans == 2 ? [laptop('a')] : [], wait: (d) async {});
      await controller.start();
      expect(scans, 2);
      expect(controller.results.single.laptopId, 'a');
    });

    test('stop() ends the run before the next scan', () async {
      var scans = 0;
      final gate = Completer<void>();
      final controller = DiscoveryController(() async {
        scans++;
        return [];
      }, wait: (d) => gate.future);
      final run = controller.start();
      await Future<void>.delayed(Duration.zero);
      controller.stop();
      gate.complete();
      await run;
      expect(scans, 1);
    });

    test('scanNow forgets earlier results and reports scanning state', () async {
      var round = 0;
      final controller = DiscoveryController(() async => ++round == 1 ? [laptop('a')] : [laptop('b')], wait: (d) async {});
      final states = <bool>[];
      controller.addListener(() => states.add(controller.scanning));
      await controller.scanNow();
      await controller.scanNow();
      expect(controller.results.map((l) => l.laptopId), ['b']);
      expect(states, [true, false, true, false]);
    });

    test('a scan that throws counts as finding nothing', () async {
      final controller = DiscoveryController(() async => throw const SocketException('no network'), wait: (d) async {}, retryDelays: const []);
      await controller.start();
      expect(controller.results, isEmpty);
      expect(controller.scanning, isFalse);
    });
  });
}
