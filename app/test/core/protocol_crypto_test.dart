import 'dart:typed_data';

import 'package:flashpush/core/protocol_crypto.dart';
import 'package:flutter_test/flutter_test.dart';

// Known-answer vectors from docs/pairing.md (the server tests assert the same values).
Uint8List seq(int start, int n) => Uint8List.fromList(List.generate(n, (i) => start + i));

String hex(Uint8List b) => b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();

void main() {
  final fp = seq(0x00, 32);
  final np = seq(0x10, 16);
  final nl = seq(0x20, 16);
  final requestId = seq(0x30, 16);
  const deviceId = '11111111-2222-3333-4444-555555555555';

  test('commit vector', () {
    final commit = commitOf(np);
    expect(hex(commit), '148f8a90dd839457dc23e50843a84c96c73365433d7277efea17c04322b1e017');
    expect(b64uEncode(commit), 'FI-KkN2DlFfcI-UIQ6hMlsczZUM9cnfv6hfAQyKx4Bc');
  });

  test('SAS vector including zero padding', () {
    expect(sasCode(fp, np, nl), '001004');
    expect(formatSas('001004'), '001 004');
  });

  test('status proof vector', () {
    expect(pairProof(np, requestId, deviceId), '01b5a81d7a92704f2e4bda8b6a8e86f78f88a470b7e0bca9b6b668d7b2a035f5');
  });

  test('base64url encodes without padding and round-trips', () {
    expect(b64uEncode(np), 'EBESExQVFhcYGRobHB0eHw');
    expect(b64uEncode(requestId), 'MDEyMzQ1Njc4OTo7PD0-Pw');
    expect(b64uDecode('EBESExQVFhcYGRobHB0eHw', 16), np);
  });

  test('base64url decoding is strict', () {
    for (final bad in [
      'EBESExQVFhcYGRobHB0eHx', // non-canonical trailing bits
      'EBESExQVFhcYGRobHB0eHw==', // padding
      'EBESExQV+hcYGRobHB0eHw', // standard alphabet
      'EBES ExQVFhcYGRobHB0eHw', // whitespace
      '',
    ]) {
      expect(() => b64uDecode(bad, 16), throwsFormatException, reason: bad);
    }
    expect(() => b64uDecode('EBESExQVFhcYGRobHB0', 16), throwsFormatException); // wrong length
  });

  test('primitives reject inputs of the wrong size', () {
    expect(() => commitOf(Uint8List(15)), throwsArgumentError);
    expect(() => sasCode(Uint8List(31), np, nl), throwsArgumentError);
    expect(() => sasCode(fp, np, Uint8List(17)), throwsArgumentError);
    expect(() => pairProof(np, Uint8List(15), deviceId), throwsArgumentError);
  });

  test('constantTimeEquals compares content and length', () {
    expect(constantTimeEquals(np, Uint8List.fromList(np)), isTrue);
    expect(constantTimeEquals(np, nl), isFalse);
    expect(constantTimeEquals(np, Uint8List(15)), isFalse);
  });

  test('newUuid is a lowercase version 4 UUID and differs each time', () {
    final id = newUuid();
    expect(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').hasMatch(id), isTrue);
    expect(newUuid(), isNot(id));
  });

  test('randomBytes returns fresh bytes of the requested size', () {
    expect(randomBytes(16).length, 16);
    expect(randomBytes(16), isNot(randomBytes(16)));
  });
}
