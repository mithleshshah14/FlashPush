import 'dart:io';
import 'dart:typed_data';

import 'package:flashpush/core/models.dart';
import 'package:flashpush/data/app_settings.dart';
import 'package:flashpush/data/history_cache.dart';
import 'package:flashpush/data/laptop_store.dart';
import 'package:flashpush/data/secret_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const laptop = Laptop(id: 'laptop-1', name: 'MITHLESH-PC', addresses: [LaptopAddress(host: '192.168.1.6', port: 8765, kind: 'lan')]);
final creds = Credentials(secret: 'the-secret', fingerprint: Uint8List.fromList(List.filled(32, 9)));

Item text(String id) => Item(id: id, kind: 'text', from: 'phone', time: DateTime(2026), text: id);

void main() {
  late MemorySecretStore secrets;
  late SharedPreferences prefs;
  late LaptopStore store;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    secrets = MemorySecretStore();
    store = LaptopStore(prefs, secrets);
  });

  group('LaptopStore', () {
    test('the device id is created once and is stable', () async {
      final first = await store.deviceId();
      expect(await LaptopStore(prefs, secrets).deviceId(), first);
    });

    test('credentials go to the secret store and never into preferences', () async {
      await store.save(laptop, credentials: creds);
      final everythingInPrefs = prefs.getKeys().map((k) => '$k=${prefs.get(k)}').join(' ');
      expect(everythingInPrefs.contains('the-secret'), isFalse);
      expect(secrets.values['secret.laptop-1'], 'the-secret');
      final loaded = (await store.credentialsFor('laptop-1'))!;
      expect(loaded.secret, 'the-secret');
      expect(loaded.fingerprint, creds.fingerprint);
    });

    test('saving again updates the laptop and keeps its credentials', () async {
      await store.save(laptop, credentials: creds);
      await store.save(laptop.copyWith(name: 'Renamed'));
      expect(store.laptops.single.name, 'Renamed');
      expect(await store.credentialsFor('laptop-1'), isNotNull);
    });

    test('remove wipes the laptop and both credentials', () async {
      await store.save(laptop, credentials: creds);
      await store.remove('laptop-1');
      expect(store.laptops, isEmpty);
      expect(secrets.values.keys.where((k) => k.contains('laptop-1')), isEmpty);
    });

    test('unreadable saved data counts as nothing saved', () async {
      await prefs.setString('laptops', '{broken');
      expect(store.laptops, isEmpty);
      secrets.values['secret.x'] = 's';
      secrets.values['pin.x'] = 'not-a-fingerprint';
      expect(await store.credentialsFor('x'), isNull);
    });
  });

  group('AppSettings', () {
    test('defaults, and values persist', () async {
      final settings = AppSettings(prefs);
      expect(settings.phoneName, AppSettings.defaultPhoneName);
      expect(settings.themeMode, ThemeMode.system);
      expect(settings.autoReconnect, isTrue);
      await settings.setPhoneName('  Pixel 7 ');
      await settings.setThemeMode(ThemeMode.dark);
      await settings.setAutoReconnect(false);
      final again = AppSettings(prefs);
      expect([again.phoneName, again.themeMode, again.autoReconnect], ['Pixel 7', ThemeMode.dark, false]);
    });

    test('a blank phone name falls back to the default', () async {
      final settings = AppSettings(prefs);
      await settings.setPhoneName('   ');
      expect(settings.phoneName, AppSettings.defaultPhoneName);
    });
  });

  group('HistoryCache', () {
    late Directory dir;
    late HistoryCache cache;

    setUp(() async {
      dir = await Directory.systemTemp.createTemp('flashpush-cache-');
      cache = HistoryCache(dir, maxImageBytes: 10);
      addTearDown(() => dir.delete(recursive: true));
    });

    test('items round-trip and are kept per laptop', () async {
      await cache.save('a', [text('1'), text('2')]);
      await cache.save('b', [text('3')]);
      expect((await cache.load('a')).map((i) => i.id), ['1', '2']);
      expect((await cache.load('b')).map((i) => i.id), ['3']);
      expect(await cache.load('never'), isEmpty);
    });

    test('a damaged file is ignored', () async {
      await cache.save('a', [text('1')]);
      File('${dir.path}/a/items.json').writeAsStringSync('{nope');
      expect(await cache.load('a'), isEmpty);
    });

    test('ids that could escape the folder are refused', () async {
      expect(() => cache.imageFile('..', 'x'), throwsArgumentError);
      expect(() => cache.imageFile('a', '../x'), throwsArgumentError);
      await expectLater(cache.load('../x'), completion(isEmpty)); // load never throws
    });

    test('images are copied in and the oldest are evicted beyond the size limit', () async {
      File source(int bytes) => File('${dir.path}/src')..writeAsBytesSync(List.filled(bytes, 1));
      await cache.storeImage('a', 'old', source(6));
      await cache.imageFile('a', 'old').setLastModified(DateTime.now().subtract(const Duration(minutes: 1)));
      await cache.storeImage('a', 'new', source(6)); // 12 bytes > 10: the older one goes
      expect(cache.imageFile('a', 'old').existsSync(), isFalse);
      expect(cache.imageFile('a', 'new').existsSync(), isTrue);
    });

    test('clear removes everything for one laptop only', () async {
      await cache.save('a', [text('1')]);
      await cache.save('b', [text('2')]);
      await cache.clear('a');
      expect(await cache.load('a'), isEmpty);
      expect(await cache.load('b'), isNotEmpty);
      await cache.clear('a'); // clearing twice is fine
    });
  });
}
