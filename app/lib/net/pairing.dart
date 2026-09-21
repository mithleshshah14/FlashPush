import 'dart:async';
import 'dart:typed_data';

import '../core/errors.dart';
import '../core/laptop_api.dart';
import '../core/models.dart';
import '../core/protocol_crypto.dart';

sealed class PairingProgress {
  const PairingProgress();
}

/// The request is visible on the laptop; the user compares this code with the one shown there.
class PairingWaiting extends PairingProgress {
  const PairingWaiting(this.sasDisplay);
  final String sasDisplay;
}

class PairingApproved extends PairingProgress {
  const PairingApproved(this.laptop, this.credentials);
  final Laptop laptop;
  final Credentials credentials;
}

class PairingDenied extends PairingProgress {
  const PairingDenied();
}

class PairingExpired extends PairingProgress {
  const PairingExpired();
}

class PairingFailed extends PairingProgress {
  const PairingFailed(this.error);
  final Object error;
}

const _maxConsecutiveNetworkErrors = 5;

/// The phone's side of the pairing protocol (docs/pairing.md): commit, receive the laptop's nonce,
/// reveal, show the 6-digit code, then poll until the user approves or denies on the laptop.
/// The fingerprint used for the code is the one the TLS session actually presented.
class PairingFlow {
  PairingFlow({
    required this.api,
    required this.deviceId,
    required this.deviceName,
    this.pollInterval = const Duration(milliseconds: 1500),
    Future<void> Function(Duration)? wait,
    Uint8List Function()? nonce,
  })  : _wait = wait ?? Future.delayed,
        _nonce = nonce ?? (() => randomBytes(16));

  final LaptopApi api;
  final String deviceId;
  final String deviceName;
  final Duration pollInterval;
  final Future<void> Function(Duration) _wait;
  final Uint8List Function() _nonce;
  bool _cancelled = false;

  /// Stops polling; the stream ends without a final event.
  void cancel() => _cancelled = true;

  Stream<PairingProgress> run() async* {
    final np = _nonce();
    final PairRequest request;
    final Uint8List fingerprint;
    try {
      request = await api.pairRequest(deviceId: deviceId, deviceName: deviceName, commit: commitOf(np));
      final seen = api.seenFingerprint;
      if (seen == null) throw const Unreachable();
      fingerprint = seen;
      await api.pairReveal(requestId: request.requestId, np: np);
    } on Object catch (error) {
      yield PairingFailed(error);
      return;
    }
    yield PairingWaiting(formatSas(sasCode(fingerprint, np, request.nl)));

    final proof = pairProof(np, b64uDecode(request.requestId, 16), deviceId);
    var networkErrors = 0;
    while (!_cancelled) {
      try {
        final status = await api.pairStatus(requestId: request.requestId, deviceId: deviceId, proof: proof);
        networkErrors = 0;
        if (_cancelled) return;
        if (status.approved) {
          yield PairingApproved(_laptopFrom(status), Credentials(secret: status.secret!, fingerprint: fingerprint));
          return;
        }
      } on ApiException catch (error) {
        yield error.code == 'PAIR_DENIED' ? const PairingDenied() : const PairingExpired();
        return;
      } on Unreachable catch (error) {
        if (++networkErrors >= _maxConsecutiveNetworkErrors) {
          yield PairingFailed(error);
          return;
        }
      } on Object catch (error) {
        yield PairingFailed(error);
        return;
      }
      await _wait(pollInterval);
    }
  }

  /// The laptop's own address list, plus the address used here (it may be a name typed by the user).
  Laptop _laptopFrom(PairStatus status) {
    final used = LaptopAddress(host: api.host, port: api.port, kind: 'manual');
    final addresses = [...status.addresses];
    if (!addresses.contains(used)) addresses.add(used);
    return Laptop(id: status.laptop!.laptopId, name: status.laptop!.name, addresses: addresses, lastHost: api.host);
  }
}
