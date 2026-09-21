import 'dart:io';
import 'dart:typed_data';

import 'models.dart';
import 'sse.dart';

typedef Progress = void Function(int done, int total);

class Hello {
  const Hello({required this.laptopId, required this.name});

  final String laptopId;
  final String name;
}

class PairRequest {
  const PairRequest({required this.requestId, required this.nl});

  final String requestId; // base64url
  final Uint8List nl;
}

class PairStatus {
  const PairStatus.pending()
      : approved = false,
        secret = null,
        laptop = null,
        addresses = const [];

  const PairStatus.approved({required String this.secret, required Hello this.laptop, required this.addresses}) : approved = true;

  final bool approved;
  final String? secret;
  final Hello? laptop;
  final List<LaptopAddress> addresses;
}

class Session {
  const Session({required this.token, required this.expiresAt, required this.laptop, required this.addresses});

  final String token;
  final DateTime expiresAt;
  final Hello laptop;
  final List<LaptopAddress> addresses;
}

/// The one network seam of the app (docs/protocol.md). Everything above it is tested with fakes;
/// [HttpLaptopApi] is tested against the real server.
///
/// Failures are [ApiException] (the laptop answered with an error), `CertificateChanged`
/// (a different certificate than the pinned one) or `Unreachable`.
abstract class LaptopApi {
  String get host;
  int get port;

  /// The fingerprint of the certificate seen so far, used to pin a laptop when pairing.
  Uint8List? get seenFingerprint;

  Future<Hello> hello();
  Future<PairRequest> pairRequest({required String deviceId, required String deviceName, required Uint8List commit});
  Future<void> pairReveal({required String requestId, required Uint8List np});
  Future<PairStatus> pairStatus({required String requestId, required String deviceId, required String proof});

  /// Only allowed on a pinned connection, so the secret never reaches an unverified laptop.
  Future<Session> connect({required String deviceId, required String secret});
  Future<void> disconnect(String token);
  Future<void> forget(String token);
  Future<List<Item>> items(String token);
  Future<Item> sendText(String token, String text, String operationId);
  Future<Item> sendFile(String token, File file, String name, String operationId, {Progress? onProgress});
  Future<File> download(String token, Item item, Directory dir, {Progress? onProgress});
  Future<void> deleteItem(String token, String id);
  Stream<SseEvent> events(String token);
  void close();
}
