import 'dart:typed_data';

import 'package:flashpush/core/pinned_client.dart';
import 'package:flutter_test/flutter_test.dart';

Uint8List fp(int seed) => Uint8List.fromList(List.filled(32, seed));

void main() {
  group('acceptCertificate', () {
    test('with a pin, only the exact certificate is accepted', () {
      expect(acceptCertificate(pin: fp(1), presented: fp(1)), isTrue);
      expect(acceptCertificate(pin: fp(1), presented: fp(2)), isFalse);
    });

    test('a pin wins over whatever was seen before', () {
      expect(acceptCertificate(pin: fp(1), seen: fp(2), presented: fp(2)), isFalse);
    });

    test('without a pin the first certificate is accepted', () {
      expect(acceptCertificate(presented: fp(3)), isTrue);
    });

    test('without a pin a second, different certificate is refused', () {
      expect(acceptCertificate(seen: fp(3), presented: fp(3)), isTrue);
      expect(acceptCertificate(seen: fp(3), presented: fp(4)), isFalse);
    });
  });

  test('a fresh client has seen nothing and refused nothing', () {
    final http = PinnedHttp();
    addTearDown(http.close);
    expect(http.seenFingerprint, isNull);
    expect(http.mismatch, isFalse);
  });
}
