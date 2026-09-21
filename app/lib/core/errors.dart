/// A non-2xx answer from the laptop. Callers branch on [code], never on [message].
class ApiException implements Exception {
  ApiException(this.code, this.status, this.message, {this.retryAfter});

  final String code;
  final int status;
  final String message;
  final Duration? retryAfter;

  @override
  String toString() => 'ApiException($code, $status)';
}

/// The laptop presented a different certificate than the one pinned when pairing.
class CertificateChanged implements Exception {
  const CertificateChanged();

  @override
  String toString() => 'CertificateChanged';
}

/// No connection could be made (offline, refused, timed out).
class Unreachable implements Exception {
  const Unreachable();

  @override
  String toString() => 'Unreachable';
}
