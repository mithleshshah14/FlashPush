import 'dart:io';
import 'dart:typed_data';

import 'package:flashpush/app_controller.dart';
import 'package:flashpush/core/models.dart';
import 'package:flashpush/native.dart';
import 'package:flashpush/net/link_state.dart';
import 'package:flashpush/net/pairing.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/app_harness.dart';
import 'support/fake_laptop_api.dart';

void main() {
  test('saved laptops start as paired rows; a laptop without a secret is dropped', () async {
    final s = await setup();
    expect(s.app.rows.map((r) => r.id), ['laptop-a', 'laptop-b']);
    expect(s.app.rows.every((r) => r.paired && r.state == LinkState.paired), isTrue);

    final none = await setup(withCredentials: false);
    expect(none.app.rows, isEmpty);
    expect(none.store.laptops, isEmpty);
  });

  test('rows merge saved and discovered laptops; unpaired discoveries come last as not paired', () async {
    final s = await setup(saved: const [laptopA]);
    s.discovered.addAll(const [
      DiscoveredLaptop(laptopId: 'laptop-c', name: 'Office-Desktop', host: '192.168.1.22', port: 8765),
      DiscoveredLaptop(laptopId: 'laptop-a', name: 'MITHLESH-PC', host: '192.168.1.6', port: 8765),
    ]);
    await s.app.discovery.scanNow();
    final rows = s.app.rows;
    expect(rows.map((r) => r.id), ['laptop-a', 'laptop-c']);
    expect(rows.last.state, LinkState.notPaired);
    expect(rows.last.paired, isFalse);
    expect(rows.last.discovered!.host, '192.168.1.22');
  });

  test('connected laptops are listed first', () async {
    final s = await setup();
    await s.app.connect('laptop-b');
    expect(s.app.rows.first.id, 'laptop-b');
    expect(s.app.active!.laptop.id, 'laptop-b');
  });

  test('connecting a second laptop disconnects the first', () async {
    final s = await setup();
    await s.app.connect('laptop-a');
    await s.app.connect('laptop-b');
    expect(s.app.connectionFor('laptop-a')!.state, LinkState.paired);
    expect(s.app.connectionFor('laptop-b')!.connected, isTrue);
    expect(s.netA.disconnected, isNotEmpty);
  });

  test('disconnect ends only that connection', () async {
    final s = await setup();
    await s.app.connect('laptop-a');
    await s.app.disconnect('laptop-a');
    expect(s.app.active, isNull);
  });

  test('a saved laptop discovered at a new address learns it', () async {
    final s = await setup(saved: const [laptopA]);
    s.discovered.add(const DiscoveredLaptop(laptopId: 'laptop-a', name: 'MITHLESH-PC', host: '192.168.1.99', port: 8765));
    await s.app.discovery.scanNow();
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(s.store.laptop('laptop-a')!.addresses.map((a) => a.host), ['192.168.1.6', '192.168.1.99']);
  });

  test('forget wipes credentials and history and drops the row', () async {
    final s = await setup();
    await s.app.connect('laptop-a');
    await s.app.forget('laptop-a');
    expect(s.app.rows.map((r) => r.id), ['laptop-b']);
    expect(await s.store.credentialsFor('laptop-a'), isNull);
    expect(await s.cache.load('laptop-a'), isEmpty);
    await s.app.forget('laptop-a'); // forgetting twice is harmless
  });

  test('addressOf gives the last verified address for Re-pair, without forgetting anything', () async {
    final s = await setup();
    expect(s.app.addressOf('laptop-a')!.host, '192.168.1.6');
    expect(s.app.addressOf('unknown'), isNull);
    expect(await s.store.credentialsFor('laptop-a'), isNotNull);
  });

  test('finishing a pairing saves the credentials and connects at once', () async {
    final s = await setup(saved: const []);
    final approved = PairingApproved(laptopA, creds());
    final connection = await s.app.finishPairing(approved);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect((await s.store.credentialsFor('laptop-a'))!.secret, 'secret');
    expect(connection.connected, isTrue);
    expect(s.app.rows.single.state, LinkState.connected);
  });

  test('a re-pair replaces the old credentials', () async {
    final s = await setup(saved: const [laptopA]);
    await s.app.finishPairing(PairingApproved(laptopA, Credentials(secret: 'new-secret', fingerprint: Uint8List(32))));
    expect((await s.store.credentialsFor('laptop-a'))!.secret, 'new-secret');
    expect(s.app.rows.length, 1);
  });

  test('a share is refused without a connection and sent with one', () async {
    final s = await setup();
    final dir = await Directory.systemTemp.createTemp('flashpush-share-');
    addTearDown(() => dir.delete(recursive: true));
    final file = File('${dir.path}/shared.txt')..writeAsStringSync('body');
    final payload = SharePayload(text: 'a link', files: [SharedFile(file.path, 'shared.txt')]);

    expect(await s.app.handleShare(payload), ShareResult.needsConnection);
    expect(s.netA.sentTexts, isEmpty);

    await s.app.connect('laptop-a');
    expect(await s.app.handleShare(payload), ShareResult.sent);
    expect(s.netA.sentTexts, ['a link']);
    expect(s.netA.operationIds.length, 2);
  });

  test('going to the background pauses connections; coming back refetches', () async {
    final s = await setup();
    await s.app.connect('laptop-a');
    s.app.didChangeAppLifecycleState(AppLifecycleState.paused);
    s.netA.items = [FakeNetwork().textItem('a1'), FakeNetwork().textItem('missed')];
    s.app.didChangeAppLifecycleState(AppLifecycleState.resumed);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(s.app.connectionFor('laptop-a')!.items.map((i) => i.id), ['a1', 'missed']);
    expect(s.netA.eventsOpened, 2);
  });

  test('with auto-reconnect off an unreachable laptop is tried once, not retried', () async {
    final s = await setup();
    await s.app.setAutoReconnect(false);
    s.netA.unreachableHosts.add('192.168.1.6');
    await s.app.connect('laptop-a');
    expect(s.app.connectionFor('laptop-a')!.state, LinkState.unreachable);
    expect(s.netA.helloCalls, 1);
  });

  test('settings persist and notify', () async {
    final s = await setup();
    var notified = 0;
    s.app.addListener(() => notified++);
    await s.app.setPhoneName('Pixel 7');
    await s.app.setThemeMode(ThemeMode.dark);
    expect(s.settings.phoneName, 'Pixel 7');
    expect(s.app.themeMode, ThemeMode.dark);
    expect(notified, greaterThanOrEqualTo(2));
  });

  test('a pairing attempt uses this phone\'s name and permanent id', () async {
    final s = await setup(saved: const []);
    await s.app.setPhoneName('Pixel 7');
    final flow = s.app.beginPairing('192.168.1.6', 8765);
    expect(flow.deviceName, 'Pixel 7');
    expect(flow.deviceId, await s.store.deviceId());
  });
}
