import 'dart:io';
import 'dart:typed_data';

import 'package:flashpush/app_controller.dart';
import 'package:flashpush/core/laptop_api.dart';
import 'package:flashpush/core/models.dart';
import 'package:flashpush/data/app_settings.dart';
import 'package:flashpush/data/history_cache.dart';
import 'package:flashpush/data/laptop_store.dart';
import 'package:flashpush/data/secret_store.dart';
import 'package:flashpush/net/discovery.dart';
import 'package:flashpush/ui/platform_actions.dart';
import 'package:flashpush/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_laptop_api.dart';

const laptopA = Laptop(id: 'laptop-a', name: 'MITHLESH-PC', addresses: [LaptopAddress(host: '192.168.1.6', port: 8765, kind: 'lan')]);
const laptopB = Laptop(id: 'laptop-b', name: 'Studio-Laptop', addresses: [LaptopAddress(host: '192.168.2.6', port: 8765, kind: 'lan')]);

Credentials creds() => Credentials(secret: 'secret', fingerprint: Uint8List(32));

class Setup {
  Setup(this.app, this.store, this.settings, this.cache, this.netA, this.netB, this.discovered, this.secrets);

  final AppController app;
  final LaptopStore store;
  final AppSettings settings;
  final HistoryCache cache;
  final FakeNetwork netA;
  final FakeNetwork netB;
  final List<DiscoveredLaptop> discovered;
  final MemorySecretStore secrets;
}

Future<Setup> setup({
  List<Laptop> saved = const [laptopA, laptopB],
  bool withCredentials = true,
  LaptopApi Function(String host, int port, Uint8List? pin)? apiOverride,
  Future<void> Function(Duration)? pairingWait,
}) async {
  TestWidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final secrets = MemorySecretStore();
  final store = LaptopStore(prefs, secrets);
  for (final l in saved) {
    await store.save(l, credentials: withCredentials ? creds() : null);
  }
  final settings = AppSettings(prefs);
  final dir = await Directory.systemTemp.createTemp('flashpush-app-');
  addTearDown(() => dir.delete(recursive: true));
  final cache = HistoryCache(dir);
  final netA = FakeNetwork()
    ..laptopId = 'laptop-a'
    ..items = [FakeNetwork().textItem('a1')];
  final netB = FakeNetwork()
    ..laptopId = 'laptop-b'
    ..laptopName = 'Studio-Laptop'
    ..sessionAddresses = const [LaptopAddress(host: '192.168.2.6', port: 8765, kind: 'lan')];
  final discovered = <DiscoveredLaptop>[];
  final discovery = DiscoveryController(() async => [...discovered], wait: (d) async {}, retryDelays: const []);
  final app = AppController(
    store: store,
    settings: settings,
    cache: cache,
    apiFor: apiOverride ?? (host, port, pin) => (host.startsWith('192.168.2.') ? netB : netA).apiFor(host, port, pin),
    discovery: discovery,
    pairingWait: pairingWait,
  );
  await app.init();
  addTearDown(app.dispose);
  return Setup(app, store, settings, cache, netA, netB, discovered, secrets);
}

/// A themed app around [child], the way the real app is set up.
Widget wrap(Widget child, {Brightness brightness = Brightness.dark}) => MaterialApp(theme: buildTheme(brightness), home: child);

/// A phone-sized screen (412 x 915 dp) for widget tests, restored after the test.
void usePhoneScreen(WidgetTester tester) {
  tester.view.physicalSize = const Size(412 * 3, 915 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

/// Records what the screens ask of the Android platform, and answers from scripted values.
class FakeActions {
  List<PickedFile> toPick = [];
  bool canOpenLinks = true;
  final List<bool> picks = []; // imagesOnly of each picker call
  final List<(String path, String name)> saved = [];
  final List<String> opened = [];

  PlatformActions get actions => PlatformActions(
        pickFiles: ({required bool imagesOnly}) async {
          picks.add(imagesOnly);
          return toPick;
        },
        saveToDownloads: (path, name) async {
          saved.add((path, name));
          return 'Downloads/FlashPush/$name';
        },
        openLink: (url) async {
          opened.add(url);
          return canOpenLinks;
        },
      );
}
