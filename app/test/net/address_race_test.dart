import 'dart:async';

import 'package:flashpush/net/address_race.dart';
import 'package:flutter_test/flutter_test.dart';

Future<String> after(int ms, String value) => Future.delayed(Duration(milliseconds: ms), () => value);

void main() {
  test('the fastest success wins and the others are cancelled', () async {
    final tokens = <String, CancelToken>{};
    final winner = await raceAddresses<String, String>(['slow', 'fast'], (c, cancel) {
      tokens[c] = cancel;
      return after(c == 'fast' ? 10 : 200, c);
    });
    expect(winner!.candidate, 'fast');
    expect(tokens['fast']!.cancelled, isFalse);
    expect(tokens['slow']!.cancelled, isTrue);
  });

  test('a dead address does not delay the others', () async {
    final tokens = <String, CancelToken>{};
    final watch = Stopwatch()..start();
    final winner = await raceAddresses<String, String>(['dead', 'live'], (c, cancel) {
      tokens[c] = cancel;
      return c == 'dead' ? Completer<String>().future : after(10, c);
    });
    expect(winner!.candidate, 'live');
    expect(watch.elapsedMilliseconds, lessThan(1000), reason: 'must not wait for the 3 s timeout of the dead address');
    expect(tokens['dead']!.cancelled, isTrue);
  });

  test('failures lose quietly; when all fail the result is null', () async {
    final winner = await raceAddresses<String, String>(['a', 'b'], (c, cancel) async => throw Exception('refused'));
    expect(winner, isNull);
  });

  test('a candidate that exceeds the timeout loses and is cancelled', () async {
    late CancelToken token;
    final winner = await raceAddresses<String, String>(['hang'], (c, cancel) {
      token = cancel;
      return Completer<String>().future;
    }, timeout: const Duration(milliseconds: 50));
    expect(winner, isNull);
    expect(token.cancelled, isTrue);
  });

  test('no candidates gives null at once', () async {
    expect(await raceAddresses<String, String>([], (c, cancel) => after(1, c)), isNull);
  });

  test('a token calls callbacks registered before and after cancellation exactly once', () {
    final token = CancelToken();
    var calls = 0;
    token.onCancel(() => calls++);
    token.cancel();
    token.cancel();
    token.onCancel(() => calls++);
    expect(calls, 2);
  });
}
