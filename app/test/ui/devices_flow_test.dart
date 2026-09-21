import 'package:flashpush/core/models.dart';
import 'package:flashpush/net/connection.dart';
import 'package:flashpush/net/link_state.dart';
import 'package:flashpush/ui/devices_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';

Future<void> settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

void main() {
  testWidgets('lists laptops in the three states with the two controls each', (tester) async {
    usePhoneScreen(tester);
    late Setup s;
    await tester.runAsync(() async => s = await setup());
    s.discovered.add(const DiscoveredLaptop(laptopId: 'laptop-c', name: 'Office-Desktop', host: '192.168.1.22', port: 8765));
    await tester.runAsync(() => s.app.discovery.scanNow());
    await tester.runAsync(() => s.app.connect('laptop-a'));

    await tester.pumpWidget(wrap(DevicesPage(controller: s.app, onOpenLaptop: (_) {}, onPair: (a, b) {})));
    await settle(tester);

    expect(find.text('Laptops'), findsOneWidget);
    expect(find.text('MITHLESH-PC'), findsOneWidget);
    expect(find.text('Studio-Laptop'), findsOneWidget);
    expect(find.text('Office-Desktop'), findsOneWidget);
    expect(find.text('Paired'), findsNWidgets(2));
    expect(find.text('Not paired'), findsOneWidget);
    expect(find.text('Needs approval on the laptop'), findsOneWidget);
    expect(find.byKey(const Key('link-control')), findsNWidgets(3));
    expect(find.textContaining('onnected'), findsNothing, reason: 'no connection words');
    expect(find.text('Pull down to scan again'), findsOneWidget);
    expect(find.text("Can't find your laptop? Add by address"), findsOneWidget);
  });

  testWidgets('the connected laptop is first and its link control disconnects it', (tester) async {
    usePhoneScreen(tester);
    late Setup s;
    await tester.runAsync(() async => s = await setup());
    await tester.runAsync(() => s.app.connect('laptop-b'));
    await tester.pumpWidget(wrap(DevicesPage(controller: s.app, onOpenLaptop: (_) {}, onPair: (a, b) {})));
    await settle(tester);

    final firstCard = find.byKey(const Key('laptop-laptop-b'));
    expect(tester.getTopLeft(firstCard).dy, lessThan(tester.getTopLeft(find.byKey(const Key('laptop-laptop-a'))).dy));
    await tester.runAsync(() async {
      await tester.tap(find.descendant(of: firstCard, matching: find.byKey(const Key('link-control'))));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    expect(s.app.connectionFor('laptop-b')!.state, LinkState.paired);
  });

  testWidgets('tapping the link of a grey laptop connects it', (tester) async {
    usePhoneScreen(tester);
    late Setup s;
    await tester.runAsync(() async => s = await setup());
    await tester.pumpWidget(wrap(DevicesPage(controller: s.app, onOpenLaptop: (_) {}, onPair: (a, b) {})));
    await settle(tester);
    await tester.runAsync(() async {
      await tester.tap(find.descendant(of: find.byKey(const Key('laptop-laptop-a')), matching: find.byKey(const Key('link-control'))));
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    expect(s.app.connectionFor('laptop-a')!.connected, isTrue);
  });

  testWidgets('an unpaired discovered laptop starts pairing; a paired card opens the detail screen', (tester) async {
    usePhoneScreen(tester);
    late Setup s;
    await tester.runAsync(() async => s = await setup(saved: const [laptopA]));
    s.discovered.add(const DiscoveredLaptop(laptopId: 'laptop-c', name: 'Office-Desktop', host: '192.168.1.22', port: 9000));
    await tester.runAsync(() => s.app.discovery.scanNow());
    String? pairedHost;
    int? pairedPort;
    LaptopConnection? opened;
    await tester.pumpWidget(wrap(DevicesPage(controller: s.app, onOpenLaptop: (c) => opened = c, onPair: (h, p) {
      pairedHost = h;
      pairedPort = p;
    })));
    await settle(tester);

    await tester.tap(find.byKey(const Key('laptop-laptop-c')));
    expect((pairedHost, pairedPort), ('192.168.1.22', 9000));
    await tester.tap(find.byKey(const Key('laptop-laptop-a')));
    expect(opened!.laptop.id, 'laptop-a');
  });

  testWidgets('with nothing found it explains and still offers Add by address', (tester) async {
    usePhoneScreen(tester);
    late Setup s;
    await tester.runAsync(() async => s = await setup(saved: const []));
    await tester.pumpWidget(wrap(DevicesPage(controller: s.app, onOpenLaptop: (_) {}, onPair: (a, b) {})));
    await settle(tester);
    expect(find.text('No laptop found yet'), findsOneWidget);
    expect(find.byKey(const Key('add-by-address')), findsOneWidget);
  });

  testWidgets('Add by address validates the input, then starts pairing with the typed address', (tester) async {
    usePhoneScreen(tester);
    late Setup s;
    await tester.runAsync(() async => s = await setup(saved: const []));
    String? host;
    int? port;
    await tester.pumpWidget(wrap(DevicesPage(controller: s.app, onOpenLaptop: (_) {}, onPair: (h, p) {
      host = h;
      port = p;
    })));
    await settle(tester);

    await tester.tap(find.byKey(const Key('add-by-address')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('address-field')), 'not an address!');
    await tester.tap(find.text('Connect'));
    await tester.pump();
    expect(find.textContaining('Enter an IP address'), findsOneWidget);
    expect(host, isNull);

    await tester.enterText(find.byKey(const Key('address-field')), 'laptop.tail1234.ts.net:9001');
    await tester.tap(find.text('Connect'));
    await tester.pumpAndSettle();
    expect((host, port), ('laptop.tail1234.ts.net', 9001));
  });
}
