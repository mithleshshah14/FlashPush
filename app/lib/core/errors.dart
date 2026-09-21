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

/// An action needed a live session but the phone is not connected to the laptop.
class NotConnected implements Exception {
  const NotConnected();

  @override
  String toString() => 'NotConnected';
}

/// No connection could be made (offline, refused, timed out).
class Unreachable implements Exception {
  const Unreachable();

  @override
  String toString() => 'Unreachable';
}

/// A short, friendly explanation for a failed action. Branches on error codes, never on messages.
String userMessage(Object error) {
  if (error is NotConnected) return 'Connect to the laptop first.';
  if (error is Unreachable) return 'Could not reach the laptop.';
  if (error is CertificateChanged) return 'The laptop identity changed. Pair again to continue.';
  if (error is ApiException) {
    switch (error.code) {
      case 'PAYLOAD_TOO_LARGE':
        return 'That is too large to send.';
      case 'INSUFFICIENT_STORAGE':
      case 'STORAGE_QUOTA':
        return 'The laptop has no room for that.';
      case 'RATE_LIMITED':
        return 'The laptop is busy. Try again in a moment.';
      case 'DEVICE_NOT_PAIRED':
        return 'The laptop no longer knows this phone.';
    }
  }
  return 'Something went wrong. Try again.';
}
