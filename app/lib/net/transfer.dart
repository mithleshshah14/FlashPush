import 'dart:io';

import '../core/errors.dart';
import '../core/laptop_api.dart';
import '../core/models.dart';
import '../core/protocol_crypto.dart';
import 'connection.dart';

const _maxAttempts = 3;

/// Sends with one operation id for every attempt, so a retry after a lost response cannot store
/// the item twice (docs/protocol.md, X-Operation-Id). Network errors and rate limits are retried;
/// anything else is the laptop's real answer and is passed on.
Future<Item> _sendWithRetry(Future<Item> Function() send, Future<void> Function(Duration) wait) async {
  for (var attempt = 1;; attempt++) {
    try {
      return await send();
    } on Unreachable {
      if (attempt >= _maxAttempts) rethrow;
      await wait(Duration(seconds: attempt));
    } on ApiException catch (error) {
      if (error.code != 'RATE_LIMITED' || attempt >= _maxAttempts) rethrow;
      await wait(error.retryAfter ?? const Duration(seconds: 1));
    }
  }
}

Future<Item> sendText(LaptopConnection connection, String text, {Future<void> Function(Duration)? wait}) {
  final operationId = newUuid();
  return _sendWithRetry(
    () => connection.withSession((api, token) => api.sendText(token, text, operationId)),
    wait ?? Future.delayed,
  );
}

Future<Item> sendFile(LaptopConnection connection, File file, String name, {Progress? onProgress, Future<void> Function(Duration)? wait}) {
  final operationId = newUuid();
  return _sendWithRetry(
    () => connection.withSession((api, token) => api.sendFile(token, file, name, operationId, onProgress: onProgress)),
    wait ?? Future.delayed,
  );
}
