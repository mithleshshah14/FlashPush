import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as c;

/// The pairing primitives, byte for byte as specified in docs/pairing.md.
/// All concatenations are raw bytes with no separators or length prefixes.

const _commitLabel = 'FLASHPUSH-COMMIT-v1';
const _sasLabel = 'FLASHPUSH-SAS-v1';
const _statusLabel = 'FLASHPUSH-STATUS-v1';

final _b64uPattern = RegExp(r'^[A-Za-z0-9_-]+$');
final _random = Random.secure();

String b64uEncode(List<int> bytes) => base64Url.encode(bytes).replaceAll('=', '');

/// Strict base64url: no padding, no other alphabet, canonical trailing bits, optional exact length.
Uint8List b64uDecode(String text, [int? length]) {
  if (!_b64uPattern.hasMatch(text)) throw const FormatException('Invalid base64url string');
  final bytes = Uint8List.fromList(base64Url.decode(base64Url.normalize(text)));
  if (b64uEncode(bytes) != text) throw const FormatException('Non-canonical base64url string');
  if (length != null && bytes.length != length) {
    throw FormatException('Expected $length bytes, got ${bytes.length}');
  }
  return bytes;
}

Uint8List sha256(List<int> bytes) => Uint8List.fromList(c.sha256.convert(bytes).bytes);

Uint8List randomBytes(int n) => Uint8List.fromList(List.generate(n, (_) => _random.nextInt(256)));

/// A random (version 4) UUID in the lowercase form the laptop validates.
String newUuid() {
  final b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}

void _requireLength(Uint8List bytes, int length, String name) {
  if (bytes.length != length) throw ArgumentError('$name must be $length bytes');
}

Uint8List _concat(List<List<int>> parts) => Uint8List.fromList([for (final p in parts) ...p]);

/// commit = SHA256("FLASHPUSH-COMMIT-v1" || np)
Uint8List commitOf(Uint8List np) {
  _requireLength(np, 16, 'np');
  return sha256(_concat([ascii.encode(_commitLabel), np]));
}

/// 6 digits: uint32_be(SHA256("FLASHPUSH-SAS-v1" || fp || np || nl)[0..4]) mod 1,000,000, zero padded.
String sasCode(Uint8List fingerprint, Uint8List np, Uint8List nl) {
  _requireLength(fingerprint, 32, 'fingerprint');
  _requireLength(np, 16, 'np');
  _requireLength(nl, 16, 'nl');
  final hash = sha256(_concat([ascii.encode(_sasLabel), fingerprint, np, nl]));
  final value = ByteData.sublistView(hash).getUint32(0, Endian.big);
  return (value % 1000000).toString().padLeft(6, '0');
}

String formatSas(String code) => '${code.substring(0, 3)} ${code.substring(3)}';

/// proof = hex(HMAC-SHA256(key = np, "FLASHPUSH-STATUS-v1" || requestId || UTF-8(deviceId)))
String pairProof(Uint8List np, Uint8List requestId, String deviceId) {
  _requireLength(np, 16, 'np');
  _requireLength(requestId, 16, 'requestId');
  final message = _concat([ascii.encode(_statusLabel), requestId, utf8.encode(deviceId)]);
  return c.Hmac(c.sha256, np).convert(message).toString();
}

bool constantTimeEquals(List<int> a, List<int> b) {
  if (a.length != b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff == 0;
}
