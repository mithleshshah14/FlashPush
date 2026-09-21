import 'dart:io';
import 'dart:typed_data';

import 'protocol_crypto.dart';

/// Certificate acceptance rule.
/// With a [pin], only that exact certificate is accepted. Without one (first pairing) the first
/// certificate seen is recorded and only that same certificate is accepted afterwards.
bool acceptCertificate({Uint8List? pin, Uint8List? seen, required Uint8List presented}) {
  final expected = pin ?? seen;
  return expected == null || constantTimeEquals(expected, presented);
}

/// An [HttpClient] that trusts no certificate authority: every certificate goes through
/// [acceptCertificate], so a laptop is only ever trusted by the fingerprint that was approved.
class PinnedHttp {
  PinnedHttp({this.pin}) {
    client = HttpClient(context: SecurityContext(withTrustedRoots: false))
      ..connectionTimeout = const Duration(seconds: 3)
      ..badCertificateCallback = _onCertificate;
  }

  final Uint8List? pin;
  late final HttpClient client;

  /// The fingerprint of the certificate the laptop presented (null before the first handshake).
  Uint8List? seenFingerprint;

  /// True once a certificate that did not match was refused.
  bool mismatch = false;

  bool _onCertificate(X509Certificate cert, String host, int port) {
    final presented = sha256(cert.der);
    final accepted = acceptCertificate(pin: pin, seen: seenFingerprint, presented: presented);
    if (accepted) {
      seenFingerprint ??= presented;
    } else {
      mismatch = true;
    }
    return accepted;
  }

  void close() => client.close(force: true);
}
