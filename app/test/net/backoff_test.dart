import 'package:flashpush/net/backoff.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('doubles from 2 s and is capped at 60 s', () {
    final backoff = Backoff();
    final seconds = [for (var i = 0; i < 8; i++) backoff.next().inSeconds];
    expect(seconds, [2, 4, 8, 16, 32, 60, 60, 60]);
  });

  test('reset starts over', () {
    final backoff = Backoff()
      ..next()
      ..next();
    backoff.reset();
    expect(backoff.next(), const Duration(seconds: 2));
  });
}
