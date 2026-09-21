import 'package:flashpush/core/models.dart';
import 'package:flashpush/ui/settings_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';

/// The list is lazy: scroll until the item exists, then bring it fully on screen.
Future<void> reveal(WidgetTester tester, Key key) async {
  await tester.scrollUntilVisible(find.byKey(key), 200, scrollable: find.descendant(of: find.byType(ListView), matching: find.byType(Scrollable)).first);
  await tester.ensureVisible(find.byKey(key));
  await tester.pump();
}

Future<({Setup s, FakeActions actions, List<(String, int)> rePaired})> openSettings(WidgetTester tester, {List<Laptop> saved = const [laptopA, laptopB]}) async {
  usePhoneScreen(tester);
  late Setup s;
  await tester.runAsync(() async => s = await setup(saved: saved));
  final actions = FakeActions();
  final rePaired = <(String, int)>[];
  await tester.pumpWidget(wrap(SettingsPage(controller: s.app, actions: actions.actions, onRePair: (h, p) => rePaired.add((h, p)))));
  await tester.pump();
  return (s: s, actions: actions, rePaired: rePaired);
}

void main() {
  testWidgets('the phone name is saved and used for pairing', (tester) async {
    final t = await openSettings(tester);
    expect(find.widgetWithText(TextField, 'Android phone'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('phone-name')), '  Pixel 7  ');
    await tester.runAsync(() async {
      await tester.tap(find.byKey(const Key('save-name')));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pump();
    expect(t.s.settings.phoneName, 'Pixel 7');
    expect(find.text('Phone name saved'), findsOneWidget);
  });

  testWidgets('paired laptops are listed with Re-pair and Forget', (tester) async {
    await openSettings(tester);
    expect(find.text('MITHLESH-PC'), findsOneWidget);
    expect(find.text('Studio-Laptop'), findsOneWidget);
    expect(find.text('Re-pair'), findsNWidgets(2));
  });

  testWidgets('with no paired laptop it says so', (tester) async {
    await openSettings(tester, saved: const []);
    expect(find.text('No laptops paired yet.'), findsOneWidget);
  });

  testWidgets('Re-pair starts pairing at the laptop\'s address and forgets nothing yet', (tester) async {
    final t = await openSettings(tester);
    await tester.tap(find.descendant(of: find.byKey(const Key('paired-laptop-a')), matching: find.text('Re-pair')));
    expect(t.rePaired.single, ('192.168.1.6', 8765));
    expect(t.s.store.laptops.length, 2);
  });

  testWidgets('Forget asks first; Cancel keeps the laptop, Forget removes it', (tester) async {
    final t = await openSettings(tester);
    Future<void> tapForget() => tester.tap(find.descendant(of: find.byKey(const Key('paired-laptop-a')), matching: find.text('Forget')));

    await tapForget();
    await tester.pumpAndSettle();
    expect(find.text('Forget MITHLESH-PC?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(t.s.store.laptops.length, 2);

    await tapForget();
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      await tester.tap(find.widgetWithText(FilledButton, 'Forget'));
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200))); // history folder removal finishes
    await tester.pumpAndSettle();
    expect(t.s.store.laptops.map((l) => l.id), ['laptop-b']);
    expect(find.byKey(const Key('paired-laptop-a')), findsNothing);
  });

  testWidgets('Appearance and auto-reconnect are stored', (tester) async {
    final t = await openSettings(tester);
    await tester.runAsync(() async {
      await tester.tap(find.text('Dark'));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pump();
    expect(t.s.settings.themeMode, ThemeMode.dark);

    expect(t.s.settings.autoReconnect, isTrue);
    await tester.runAsync(() async {
      await tester.tap(find.byKey(const Key('auto-reconnect')));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pump();
    expect(t.s.settings.autoReconnect, isFalse);
  });

  testWidgets('Scan again triggers a discovery scan', (tester) async {
    final t = await openSettings(tester);
    final before = t.s.scans[0];
    await reveal(tester, const Key('scan-again'));
    await tester.runAsync(() async {
      await tester.tap(find.byKey(const Key('scan-again')));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    expect(t.s.scans[0], before + 1);
  });

  testWidgets('About shows the version and opens the documentation', (tester) async {
    final t = await openSettings(tester);
    await reveal(tester, const Key('documentation'));
    expect(find.text('Version 2.0.0'), findsOneWidget);
    await tester.tap(find.byKey(const Key('documentation')));
    expect(t.actions.opened, [documentationUrl]);
  });
}
