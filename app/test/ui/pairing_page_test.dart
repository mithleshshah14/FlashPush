import 'dart:async';

import 'package:flashpush/core/errors.dart';
import 'package:flashpush/core/protocol_crypto.dart';
import 'package:flashpush/net/connection.dart';
import 'package:flashpush/ui/pairing_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_laptop_api.dart';
import '../support/fake_pairing_api.dart';

/// The pairing laptop is served for unpinned connections; pinned ones (after pairing) go to the fake network.
Future<({Setup s, FakePairingApi laptop})> pairingSetup(WidgetTester tester) async {
  usePhoneScreen(tester);
  final laptop = FakePairingApi();
  final network = FakeNetwork();
  late Setup s;
  await tester.runAsync(() async {
    s = await setup(
      saved: const [],
      apiOverride: (host, port, pin) => pin == null ? laptop : network.apiFor(host, port, pin),
      pairingWait: (d) => Completer<void>().future, // never polls again: no real timers in widget tests
    );
  });
  return (s: s, laptop: laptop);
}

Future<void> settle(WidgetTester tester) async {
  await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
  await tester.pump();
}

/// Route transitions finish in 300 ms; the waiting screen has an endless spinner, so pumpAndSettle would not return.
Future<void> transition(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

void main() {
  testWidgets('shows the same code as the laptop, and Cancel leaves without pairing', (tester) async {
    final p = await pairingSetup(tester);
    LaptopConnection? result;
    var popped = false;
    await tester.pumpWidget(wrap(Builder(builder: (context) => Scaffold(body: Center(child: TextButton(
      onPressed: () async {
        result = await Navigator.of(context).push<LaptopConnection>(MaterialPageRoute(builder: (_) => PairingPage(controller: p.s.app, host: '192.168.1.6', port: 8765)));
        popped = true;
      },
      child: const Text('go'),
    ))))));
    await tester.tap(find.text('go'));
    await transition(tester);
    await settle(tester);

    expect(find.byKey(const Key('pairing-code')), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('pairing-code'))).data, formatSas(p.laptop.laptopSas!));
    expect(find.textContaining('matches the one on your laptop'), findsOneWidget);
    expect(find.textContaining('Waiting for approval'), findsOneWidget);

    await tester.tap(find.text('Cancel'));
    await transition(tester);
    expect(popped, isTrue);
    expect(result, isNull);
    expect(p.s.store.laptops, isEmpty);
  });

  testWidgets('approval saves the laptop and returns its connection', (tester) async {
    final p = await pairingSetup(tester);
    p.laptop.statusScript.add(approved());
    LaptopConnection? result;
    await tester.pumpWidget(wrap(Builder(builder: (context) => Scaffold(body: Center(child: TextButton(
      onPressed: () async => result = await Navigator.of(context).push<LaptopConnection>(MaterialPageRoute(builder: (_) => PairingPage(controller: p.s.app, host: '192.168.1.6', port: 8765))),
      child: const Text('go'),
    ))))));
    await tester.tap(find.text('go'));
    await tester.pump();
    await settle(tester);
    await settle(tester);
    await transition(tester);

    expect(result!.laptop.id, 'laptop-1');
    expect((await tester.runAsync(() => p.s.store.credentialsFor('laptop-1')))!.secret, 'device-secret');
  });

  testWidgets('a denied request says so and can be retried', (tester) async {
    final p = await pairingSetup(tester);
    p.laptop.statusScript.add(ApiException('PAIR_DENIED', 403, 'denied'));
    await tester.pumpWidget(wrap(PairingPage(controller: p.s.app, host: '192.168.1.6', port: 8765)));
    await settle(tester);
    expect(find.text('The laptop denied the request'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);

    await tester.tap(find.text('Try again'));
    await settle(tester);
    expect(find.byKey(const Key('pairing-code')), findsOneWidget, reason: 'a new attempt shows a fresh code');
  });

  testWidgets('an expired request has a clear message', (tester) async {
    final p = await pairingSetup(tester);
    p.laptop.statusScript.add(ApiException('PAIR_EXPIRED', 410, 'expired'));
    await tester.pumpWidget(wrap(PairingPage(controller: p.s.app, host: '192.168.1.6', port: 8765)));
    await settle(tester);
    expect(find.text('The request expired'), findsOneWidget);
  });

  testWidgets('an unreachable laptop has a clear message', (tester) async {
    final p = await pairingSetup(tester);
    p.laptop.requestError = const Unreachable();
    await tester.pumpWidget(wrap(PairingPage(controller: p.s.app, host: '192.168.1.6', port: 8765)));
    await settle(tester);
    expect(find.text('Pairing did not work'), findsOneWidget);
    expect(find.text('Could not reach the laptop.'), findsOneWidget);
  });
}
