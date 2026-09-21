import 'package:flashpush/net/link_state.dart';
import 'package:flashpush/theme.dart';
import 'package:flashpush/ui/connection_controls.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget host(Widget child, {Brightness brightness = Brightness.dark}) =>
    MaterialApp(theme: buildTheme(brightness), home: Scaffold(body: Center(child: child)));

Future<void> pump(WidgetTester tester, LinkState state, RouteKind route, bool wifiUp, {VoidCallback? onLink}) =>
    tester.pumpWidget(host(ConnectionControls(state: state, route: route, wifiUp: wifiUp, onLinkPressed: onLink ?? () {})));

void main() {
  testWidgets('connected over Wi-Fi: both controls on, solid glyphs, green', (tester) async {
    await pump(tester, LinkState.connected, RouteKind.wifi, true);
    expect(find.descendant(of: find.byKey(const Key('wifi-control')), matching: find.byIcon(Icons.wifi)), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('link-control')), matching: find.byIcon(Icons.link)), findsOneWidget);
    final wifi = tester.widget<Icon>(find.descendant(of: find.byKey(const Key('wifi-control')), matching: find.byType(Icon)));
    expect(wifi.color, FlashColors.dark.on);
    expect(find.bySemanticsLabel('Wi-Fi: on'), findsOneWidget);
    expect(find.bySemanticsLabel('Linked to laptop: on. Tap to disconnect'), findsOneWidget);
  });

  testWidgets('not connected: slashed grey glyphs, and the label says how to connect', (tester) async {
    await pump(tester, LinkState.paired, RouteKind.none, false);
    expect(find.byIcon(Icons.wifi_off), findsOneWidget);
    expect(find.byIcon(Icons.link_off), findsOneWidget);
    final link = tester.widget<Icon>(find.descendant(of: find.byKey(const Key('link-control')), matching: find.byType(Icon)));
    expect(link.color, FlashColors.dark.off);
    expect(find.bySemanticsLabel('Linked to laptop: off. Tap to connect'), findsOneWidget);
  });

  testWidgets('over Tailscale the Wi-Fi control stays off while the link is on; the route is only a tooltip', (tester) async {
    await pump(tester, LinkState.connected, RouteKind.tailscale, false);
    expect(find.byIcon(Icons.wifi_off), findsOneWidget);
    expect(find.byIcon(Icons.link), findsOneWidget);
    expect(find.textContaining('Tailscale'), findsNothing, reason: 'never visible text');
    final tooltip = tester.widget<Tooltip>(find.descendant(of: find.byKey(const Key('link-control')), matching: find.byType(Tooltip)));
    expect(tooltip.message, contains('via Tailscale'));
  });

  testWidgets('there are no status words at all', (tester) async {
    for (final state in LinkState.values) {
      await pump(tester, state, RouteKind.wifi, state == LinkState.connected);
      expect(find.byType(Text), findsNothing, reason: state.name);
    }
  });

  testWidgets('connecting shows progress in the link control', (tester) async {
    await pump(tester, LinkState.connecting, RouteKind.none, false);
    expect(find.descendant(of: find.byKey(const Key('link-control')), matching: find.byType(CircularProgressIndicator)), findsOneWidget);
    expect(find.bySemanticsLabel('Linked to laptop: connecting'), findsOneWidget);
  });

  testWidgets('the link control is the button: tapping it calls back, in both states', (tester) async {
    var taps = 0;
    await pump(tester, LinkState.paired, RouteKind.none, false, onLink: () => taps++);
    await tester.tap(find.byKey(const Key('link-control')));
    await pump(tester, LinkState.connected, RouteKind.wifi, true, onLink: () => taps++);
    await tester.tap(find.byKey(const Key('link-control')));
    expect(taps, 2);
  });

  testWidgets('both controls meet the 48 dp touch target, in the light theme too', (tester) async {
    await tester.pumpWidget(host(
      ConnectionControls(state: LinkState.paired, route: RouteKind.none, wifiUp: false, onLinkPressed: () {}),
      brightness: Brightness.light,
    ));
    for (final key in ['wifi-control', 'link-control']) {
      expect(tester.getSize(find.byKey(Key(key))), const Size(48, 48));
    }
  });
}
