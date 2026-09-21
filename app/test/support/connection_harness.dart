import 'dart:io';
import 'dart:typed_data';

import 'package:flashpush/core/errors.dart';
import 'package:flashpush/core/models.dart';
import 'package:flashpush/data/history_cache.dart';
import 'package:flashpush/data/laptop_store.dart';
import 'package:flashpush/data/secret_store.dart';
import 'package:flashpush/net/connection.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_laptop_api.dart';

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
