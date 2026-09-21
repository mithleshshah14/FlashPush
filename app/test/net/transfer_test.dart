import 'dart:io';

import 'package:flashpush/core/errors.dart';
import 'package:flashpush/net/transfer.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/connection_harness.dart';

Future<Harness> connected() async {
  final h = await harness();
  await h.connection.connect();
  return h;
}

void main() {
  test('sending text works and sends one operation id', () async {
    final h = await connected();
    final item = await sendText(h.connection, 'hello', wait: (d) async {});
    expect(item.text, 'sent-1');
    expect(h.network.sentTexts, ['hello']);
    expect(h.network.operationIds.length, 1);
  });

  test('network errors are retried with the SAME operation id, then succeed', () async {
    final h = await connected();
    h.network.sendScript.addAll([const Unreachable(), const Unreachable()]);
    final waits = <Duration>[];
    await sendText(h.connection, 'hello', wait: (d) async => waits.add(d));
    expect(h.network.operationIds.length, 3);
    expect(h.network.operationIds.toSet().length, 1, reason: 'a retry must be recognisable as the same send');
    expect(waits, [const Duration(seconds: 1), const Duration(seconds: 2)]);
  });

  test('it gives up after three attempts', () async {
    final h = await connected();
    h.network.sendScript.addAll(List.filled(5, const Unreachable()));
    await expectLater(sendText(h.connection, 'x', wait: (d) async {}), throwsA(isA<Unreachable>()));
    expect(h.network.operationIds.length, 3);
  });

  test('a rate limit is retried after the time the laptop asks for', () async {
    final h = await connected();
    h.network.sendScript.add(ApiException('RATE_LIMITED', 429, 'busy', retryAfter: const Duration(seconds: 4)));
    final waits = <Duration>[];
    await sendText(h.connection, 'x', wait: (d) async => waits.add(d));
    expect(waits, [const Duration(seconds: 4)]);
  });

  test('the laptop\'s real refusals are not retried', () async {
    final h = await connected();
    h.network.sendScript.add(ApiException('PAYLOAD_TOO_LARGE', 413, 'too large'));
    await expectLater(sendText(h.connection, 'x', wait: (d) async {}), throwsA(isA<ApiException>()));
    expect(h.network.operationIds.length, 1);
  });

  test('sending while not connected is refused', () async {
    final h = await harness();
    await expectLater(sendText(h.connection, 'x', wait: (d) async {}), throwsA(isA<NotConnected>()));
  });

  test('a file send reports progress and retries with one operation id', () async {
    final h = await connected();
    final dir = await Directory.systemTemp.createTemp('flashpush-send-');
    addTearDown(() => dir.delete(recursive: true));
    final file = File('${dir.path}/a.txt')..writeAsStringSync('12345');
    h.network.sendScript.add(const Unreachable());
    var progress = 0;
    final item = await sendFile(h.connection, file, 'a.txt', onProgress: (done, total) => progress = done, wait: (d) async {});
    expect(item.name, 'a.txt');
    expect(progress, 5);
    expect(h.network.operationIds.toSet().length, 1);
    expect(h.network.operationIds.length, 2);
  });
}
