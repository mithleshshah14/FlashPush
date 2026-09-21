import 'dart:io';

import 'package:flashpush/core/errors.dart';
import 'package:flashpush/core/models.dart';
import 'package:flashpush/net/link_state.dart';
import 'package:flashpush/ui/laptop_detail_page.dart';
import 'package:flashpush/ui/platform_actions.dart';
import 'package:flashpush/ui/transfer_tab.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';

final _day = DateTime(2026, 1, 1, 10, 30);

final _history = [
  Item(id: 't1', kind: 'text', from: 'laptop', time: _day, text: 'Booked the room for 3 pm'),
  Item(id: 't2', kind: 'text', from: 'phone', time: _day, text: 'See https://docs.example.com/q3-report'),
  Item(id: 'i1', kind: 'file', from: 'laptop', time: _day, name: 'photo.png', size: 2048, mime: 'image/png'),
  Item(id: 'f1', kind: 'file', from: 'phone', time: _day, name: 'report.pdf', size: 3 * 1024 * 1024, mime: 'application/pdf'),
];

class Detail {
  Detail(this.s, this.actions, this.rePaired);

  final Setup s;
  final FakeActions actions;
  final List<(String, int)> rePaired;
}

Future<Detail> openDetail(WidgetTester tester, {bool connect = true, List<Item>? items, void Function(Setup)? prepare}) async {
  usePhoneScreen(tester);
  late Setup s;
  await tester.runAsync(() async {
    s = await setup(saved: const [laptopA]);
    s.netA.items = items ?? _history;
    prepare?.call(s);
    if (connect) await s.app.connect('laptop-a');
  });
  final actions = FakeActions();
  final rePaired = <(String, int)>[];
  await tester.pumpWidget(wrap(LaptopDetailPage(
    controller: s.app,
    laptopId: 'laptop-a',
    actions: actions.actions,
    onRePair: (host, port) => rePaired.add((host, port)),
  )));
  await tester.pump();
  return Detail(s, actions, rePaired);
}

Future<void> openTab(WidgetTester tester, String name) async {
  await tester.tap(find.text(name));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Messages, Images and Files each show only their own kind', (tester) async {
    await openDetail(tester);
    expect(find.text('MITHLESH-PC'), findsOneWidget);
    expect(find.text('Booked the room for 3 pm'), findsOneWidget);
    expect(find.text('From laptop'), findsOneWidget);
    expect(find.textContaining('q3-report'), findsOneWidget);
    expect(find.text('photo.png'), findsNothing);
    expect(find.text('report.pdf'), findsNothing);

    await openTab(tester, 'Images');
    expect(find.bySemanticsLabel('photo.png, received'), findsOneWidget);
    expect(find.text('Booked the room for 3 pm'), findsNothing);

    await openTab(tester, 'Files');
    expect(find.text('report.pdf'), findsOneWidget);
    expect(find.textContaining('3.0 MB'), findsOneWidget);
    expect(find.textContaining('Sent'), findsOneWidget);
    expect(find.text('photo.png'), findsNothing);
  });

  testWidgets('each tab has its own empty state', (tester) async {
    await openDetail(tester, items: const []);
    expect(find.text('No messages yet'), findsOneWidget);
    await openTab(tester, 'Images');
    expect(find.text('No images yet'), findsOneWidget);
    await openTab(tester, 'Files');
    expect(find.text('No files yet'), findsOneWidget);
  });

  testWidgets('the header has the two controls and no status words', (tester) async {
    await openDetail(tester);
    expect(find.byKey(const Key('wifi-control')), findsOneWidget);
    expect(find.byKey(const Key('link-control')), findsOneWidget);
    expect(find.textContaining('onnected'), findsNothing);
    expect(find.textContaining('Showing saved history'), findsNothing);
  });

  testWidgets('offline the saved history stays readable and only Connect to send is offered', (tester) async {
    late Setup s;
    final d = await openDetail(tester, connect: false, prepare: (setup) => s = setup);
    await tester.runAsync(() => d.s.app.connectionFor('laptop-a')!.cache.save('laptop-a', _history));
    await tester.runAsync(() => d.s.app.connectionFor('laptop-a')!.loadCached());
    await tester.pump();
    expect(s.app.connectionFor('laptop-a')!.state, LinkState.paired);
    expect(find.text('Showing saved history'), findsOneWidget);
    expect(find.text('Booked the room for 3 pm'), findsOneWidget);
    expect(find.byKey(const Key('new-transfer')), findsNothing);
    expect(find.byKey(const Key('connect-to-send')), findsOneWidget);

    await tester.runAsync(() async {
      await tester.tap(find.byKey(const Key('connect-to-send')));
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pump();
    expect(d.s.app.connectionFor('laptop-a')!.connected, isTrue);
    expect(find.byKey(const Key('new-transfer')), findsOneWidget);
    expect(find.text('Showing saved history'), findsNothing);
  });

  testWidgets('Open passes the link on, and a failure is reported; Copy confirms', (tester) async {
    final copied = <String>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') copied.add((call.arguments as Map)['text'] as String);
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
    final d = await openDetail(tester);
    await tester.tap(find.text('Open'));
    await tester.pump();
    expect(d.actions.opened, ['https://docs.example.com/q3-report']);

    d.actions.canOpenLinks = false;
    await tester.tap(find.text('Open'));
    await tester.pump();
    await tester.pump();
    expect(find.text('Could not open the link.'), findsOneWidget);

    await tester.tap(find.text('Copy').first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Copied'), findsOneWidget);
    expect(copied, ['Booked the room for 3 pm']);
  });

  testWidgets('New transfer asks the type first: Image, Text or Document', (tester) async {
    await openDetail(tester);
    await tester.tap(find.byKey(const Key('new-transfer')));
    await tester.pumpAndSettle();
    expect(find.text('What do you want to send?'), findsOneWidget);
    expect(find.byKey(const Key('choice-image')), findsOneWidget);
    expect(find.byKey(const Key('choice-text')), findsOneWidget);
    expect(find.byKey(const Key('choice-document')), findsOneWidget);
  });

  testWidgets('Text: compose and send reaches the laptop', (tester) async {
    final d = await openDetail(tester);
    await tester.tap(find.byKey(const Key('new-transfer')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('choice-text')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('text-field')), 'hello from the phone');
    await tester.runAsync(() async {
      await tester.tap(find.byKey(const Key('send-text')));
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pumpAndSettle();
    expect(d.s.netA.sentTexts, ['hello from the phone']);
    expect(find.byKey(const Key('text-field')), findsNothing, reason: 'the composer closes after sending');
  });

  testWidgets('Text: a failed send keeps the composer open with a friendly message', (tester) async {
    final d = await openDetail(tester);
    d.s.netA.sendScript.add(ApiException('PAYLOAD_TOO_LARGE', 413, 'x'));
    await tester.tap(find.byKey(const Key('new-transfer')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('choice-text')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('text-field')), 'too much');
    await tester.runAsync(() async {
      await tester.tap(find.byKey(const Key('send-text')));
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pump();
    expect(find.text('That is too large to send.'), findsOneWidget);
    expect(find.byKey(const Key('text-field')), findsOneWidget);
  });

  testWidgets('Image and Document open the picker (images only for Image) and upload with progress', (tester) async {
    final d = await openDetail(tester);
    final dir = await tester.runAsync(() => Directory.systemTemp.createTemp('flashpush-detail-'));
    addTearDown(() => dir!.delete(recursive: true));
    final file = File('${dir!.path}/pic.jpg')..writeAsBytesSync([1, 2, 3, 4]);
    d.actions.toPick = [PickedFile(file.path, 'pic.jpg')];

    for (final (key, imagesOnly) in [('choice-image', true), ('choice-document', false)]) {
      await tester.tap(find.byKey(const Key('new-transfer')));
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        await tester.tap(find.byKey(Key(key)));
        await Future<void>.delayed(const Duration(milliseconds: 100));
      });
      await tester.pumpAndSettle();
      expect(d.actions.picks.last, imagesOnly, reason: key);
    }
    expect(d.s.netA.operationIds.length, 2, reason: 'one upload per picked file, per type');
  });

  testWidgets('Save on a file hands it to Downloads under its name and confirms', (tester) async {
    final d = await openDetail(tester);
    await openTab(tester, 'Files');
    await tester.runAsync(() async {
      await tester.tap(find.byTooltip('Save to Downloads'));
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pump();
    await tester.pump();
    expect(d.actions.saved.single.$2, 'report.pdf');
    expect(find.text('Saved to Downloads/FlashPush/report.pdf'), findsOneWidget);
  });

  testWidgets('a laptop that no longer knows the phone offers Re-pair and Forget', (tester) async {
    final d = await openDetail(tester, connect: false, prepare: (s) => s.netA.connectScript.add(ApiException('DEVICE_NOT_PAIRED', 401, 'x')));
    await tester.runAsync(() => d.s.app.connect('laptop-a'));
    await tester.pump();
    expect(find.text('Not paired anymore'), findsOneWidget);
    expect(find.byType(TabBar), findsNothing);
    expect(find.byKey(const Key('new-transfer')), findsNothing);

    await tester.runAsync(() async {
      await tester.tap(find.byKey(const Key('problem-primary')));
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    expect(d.rePaired.single, ('192.168.1.6', 8765), reason: 'pairing restarts at the same address');
    expect(d.s.store.laptops, isNotEmpty, reason: 'nothing is forgotten until the new pairing succeeds');
  });

  testWidgets('a changed identity warns and offers Forget and pair again', (tester) async {
    final d = await openDetail(tester, connect: false, prepare: (s) => s.netA.wrongCertificateHosts.add('192.168.1.6'));
    await tester.runAsync(() => d.s.app.connect('laptop-a'));
    await tester.pump();
    expect(find.text('Laptop identity changed'), findsOneWidget);
    expect(find.text('Forget and pair again'), findsOneWidget);
    expect(find.textContaining('nothing was sent'), findsOneWidget);
    expect(d.s.netA.connectCalls, 0, reason: 'the secret is never sent to a laptop with a different certificate');
  });

  testWidgets('Forget removes the laptop and leaves the screen', (tester) async {
    usePhoneScreen(tester);
    late Setup s;
    await tester.runAsync(() async {
      s = await setup(saved: const [laptopA]);
      s.netA.connectScript.add(ApiException('DEVICE_NOT_PAIRED', 401, 'x'));
      await s.app.connect('laptop-a');
    });
    final fake = FakeActions();
    await tester.pumpWidget(wrap(Builder(builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => LaptopDetailPage(controller: s.app, laptopId: 'laptop-a', actions: fake.actions, onRePair: (a, b) {}))),
            child: const Text('open'),
          ),
        ))));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      await tester.tap(find.byKey(const Key('problem-forget')));
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pumpAndSettle();
    expect(s.store.laptops, isEmpty);
    expect(find.text('Not paired anymore'), findsNothing);
    expect(find.text('open'), findsOneWidget, reason: 'back on the previous screen');
  });

  group('Transfer tab', () {
    testWidgets('without a connection it asks to connect a laptop first', (tester) async {
      usePhoneScreen(tester);
      late Setup s;
      await tester.runAsync(() async => s = await setup());
      var wentToDevices = false;
      await tester.pumpWidget(wrap(TransferTab(controller: s.app, actions: FakeActions().actions, onGoToDevices: () => wentToDevices = true, onRePair: (a, b) {})));
      await tester.pump();
      expect(find.text('Connect a laptop first'), findsOneWidget);
      await tester.tap(find.byKey(const Key('go-to-devices')));
      expect(wentToDevices, isTrue);
    });

    testWidgets('with a connection it shows that laptop, without a back arrow', (tester) async {
      usePhoneScreen(tester);
      late Setup s;
      await tester.runAsync(() async {
        s = await setup();
        s.netA.items = _history;
        await s.app.connect('laptop-a');
      });
      await tester.pumpWidget(wrap(TransferTab(controller: s.app, actions: FakeActions().actions, onGoToDevices: () {}, onRePair: (a, b) {})));
      await tester.pump();
      expect(find.text('MITHLESH-PC'), findsOneWidget);
      expect(find.byType(BackButton), findsNothing);
      expect(find.text('Booked the room for 3 pm'), findsOneWidget);
    });
  });
}
