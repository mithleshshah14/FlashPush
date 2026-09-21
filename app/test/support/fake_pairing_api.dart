import 'dart:typed_data';

import 'package:flashpush/core/errors.dart';
import 'package:flashpush/core/laptop_api.dart';
import 'package:flashpush/core/models.dart';
import 'package:flashpush/core/protocol_crypto.dart';
import 'package:flutter_test/flutter_test.dart';

/// The laptop's side of the protocol, computed independently with the shared crypto primitives.
class FakePairingApi implements LaptopApi {
  final Uint8List fingerprint = Uint8List.fromList(List.generate(32, (i) => i));
  Uint8List? _seen;
  Uint8List? _commit;
  Uint8List? _nl;
  Uint8List? _np;
  String? _requestId;
  String? laptopSas;
  final List<String> proofs = [];
  final List<Object> statusScript = [];
  Object? requestError;
  Object? revealError;
  bool presentsNoCertificate = false;
  int statusCalls = 0;

  @override
  String get host => 'my-laptop.tail.ts.net';
  @override
  int get port => 8765;
  @override
  Uint8List? get seenFingerprint => presentsNoCertificate ? null : _seen;
  @override
  void close() {}

  @override
  Future<PairRequest> pairRequest({required String deviceId, required String deviceName, required Uint8List commit}) async {
    if (requestError != null) throw requestError!;
    _seen = fingerprint;
    _commit = commit;
    _nl = randomBytes(16);
    _requestId = b64uEncode(randomBytes(16));
    return PairRequest(requestId: _requestId!, nl: _nl!);
  }

  @override
  Future<void> pairReveal({required String requestId, required Uint8List np}) async {
    if (revealError != null) throw revealError!;
    if (!constantTimeEquals(commitOf(np), _commit!)) throw ApiException('COMMIT_MISMATCH', 400, 'mismatch');
    _np = np;
    laptopSas = sasCode(fingerprint, np, _nl!);
  }

  @override
  Future<PairStatus> pairStatus({required String requestId, required String deviceId, required String proof}) async {
    statusCalls++;
    proofs.add(proof);
    expect(proof, pairProof(_np!, b64uDecode(_requestId!, 16), deviceId), reason: 'the proof must be derived from np');
    if (statusScript.isEmpty) return const PairStatus.pending();
    final next = statusScript.removeAt(0);
    if (next is PairStatus) return next;
    throw next;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}

PairStatus approved() => const PairStatus.approved(
      secret: 'device-secret',
      laptop: Hello(laptopId: 'laptop-1', name: 'MITHLESH-PC'),
      addresses: [LaptopAddress(host: '192.168.1.6', port: 8765, kind: 'lan')],
    );
