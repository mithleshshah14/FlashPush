import 'dart:async';

import 'package:flashpush/app.dart';
import 'package:flashpush/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_laptop_api.dart';
import '../support/fake_pairing_api.dart';

class Shell {
  Shell(this.s, this.shares, this.pending);

  final Setup s;
  final StreamController<SharePayload> shares;
  final List<SharePayload> pending;
}

Future<Shell> openShell(WidgetTester tester, {List<SharePayload> pending = const [], bool connect = false, FakePairingApi? pairing}) async {
  usePhoneScreen(tester);
  late Setup s;
  final network = FakeNetwork();
  await tester.runAsync(() async {
    s = await setup(
      saved: const [laptopA],
      apiOverride: pairing == null ? null : (host, port, pin) => pin == null ? pairing : network.apiFor(host, port, pin),
      pairingWait: (d) => Completer<void>().future,
    );
    if (connect) await s.app.connect('laptop-a');
  });
  final shares = StreamController<SharePayload>.broadcast();
  addTearDown(shares.close);
  final held = [...pending];
  await tester.pumpWidget(FlashPushApp(
    controller: s.app,
    actions: FakeActions().actions,
    shares: shares.stream,
    takePendingShares: () {
      final out = [...held];
      held.clear();
      return out;
    },
  ));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
  return Shell(s, shares, held);
}

void main() {
  testWidgets('three tabs: Devices, Transfer and Settings', (tester) async {
    await openShell(tester);
    expect(find.text('Devices'), findsOneWidget);
    expect(find.text('Transfer'), findsOneWidget);
    expect(find.text('Settings'), findsOneWidget);
    expect(find.text('Laptops'), findsOneWidget, reason: 'the Devices tab is first');

    await tester.tap(find.text('Transfer'));
    await tester.pumpAndSettle();
    expect(find.text('Connect a laptop first'), findsOneWidget);
    await tester.tap(find.byKey(const Key('go-to-devices')));
    await tester.pumpAndSettle();
    expect(find.text('Laptops'), findsOneWidget);

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    expect(find.text('This phone'.toUpperCase()), findsOneWidget);
  });

  testWidgets('discovery runs only while the Devices tab is showing', (tester) async {
    final shell = await openShell(tester);
    expect(shell.s.scans[0], 1);
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Transfer'));
    await tester.pumpAndSettle();
    expect(shell.s.scans[0], 1, reason: 'no scanning off the Devices tab');
    await tester.tap(find.text('Devices'));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 50));
    expect(shell.s.scans[0], 2);
  });

  testWidgets('the theme follows the setting', (tester) async {
    final shell = await openShell(tester);
    expect(tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode, ThemeMode.system);
    await tester.runAsync(() => shell.s.app.setThemeMode(ThemeMode.dark));
    await tester.pump();
    expect(tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode, ThemeMode.dark);
  });

  testWidgets('a share that arrives without a connection asks to connect and shows Devices', (tester) async {
    final shell = await openShell(tester);
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      shell.shares.add(SharePayload(text: 'https://example.com'));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pump();
    await tester.pump();
    expect(find.text('Connect to a laptop first, then share again.'), findsOneWidget);
    expect(find.text('Laptops'), findsOneWidget);
    expect(shell.s.netA.sentTexts, isEmpty);
  });

  testWidgets('a share that launched the app is sent once connected, and confirmed', (tester) async {
    final shell = await openShell(tester, connect: true, pending: [SharePayload(text: 'a link from another app')]);
    await tester.pump(const Duration(milliseconds: 100));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
    await tester.pump();
    expect(shell.s.netA.sentTexts, ['a link from another app']);
    expect(find.text('Sent to laptop'), findsOneWidget);
  });

  testWidgets('Add by address opens the pairing screen for the typed address', (tester) async {
    await openShell(tester, pairing: FakePairingApi());
    await tester.tap(find.byKey(const Key('add-by-address')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('address-field')), '100.101.102.103');
    await tester.tap(find.text('Connect'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
    await tester.pump();
    expect(find.text('Pair with laptop'), findsOneWidget);
    expect(find.byKey(const Key('pairing-code')), findsOneWidget);
  });
}
