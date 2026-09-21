import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'errors.dart';
import 'laptop_api.dart';
import 'models.dart';
import 'pinned_client.dart';
import 'protocol_crypto.dart';
import 'sse.dart';

const _timeout = Duration(seconds: 15);
const _eventSilence = Duration(seconds: 60); // the laptop pings every 25 s

/// [LaptopApi] over HTTPS with certificate pinning.
class HttpLaptopApi implements LaptopApi {
  HttpLaptopApi(this.host, this.port, {Uint8List? pin}) : _http = PinnedHttp(pin: pin);

  @override
  final String host;
  @override
  final int port;
  final PinnedHttp _http;

  @override
  Uint8List? get seenFingerprint => _http.seenFingerprint;

  @override
  void close() => _http.close();

  // ---- transport ------------------------------------------------------------

  Future<T> _guard<T>(Future<T> Function() body) async {
    try {
      return await body();
    } on IOException {
      throw _http.mismatch ? const CertificateChanged() : const Unreachable();
    } on TimeoutException {
      throw const Unreachable();
    }
  }

  Future<HttpClientRequest> _open(String method, String path, {String? token, Map<String, String>? query, Map<String, String> headers = const {}}) async {
    final uri = Uri(scheme: 'https', host: host, port: port, path: path, queryParameters: query);
    final request = await _http.client.openUrl(method, uri);
    if (token != null) request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
    headers.forEach(request.headers.set);
    return request;
  }

  Future<ApiException> _errorFrom(HttpClientResponse response) async {
    var code = 'INTERNAL';
    var message = 'Unexpected answer from the laptop.';
    try {
      final error = (jsonDecode(await utf8.decoder.bind(response).join()) as Map<String, dynamic>)['error'] as Map<String, dynamic>;
      code = error['code'] as String;
      message = error['message'] as String;
    } on Object {
      // keep the generic error: the body was not the documented envelope
    }
    final seconds = int.tryParse(response.headers.value('retry-after') ?? '');
    return ApiException(code, response.statusCode, message, retryAfter: seconds == null ? null : Duration(seconds: seconds));
  }

  Future<Map<String, dynamic>> _readJson(HttpClientResponse response) async {
    if (response.statusCode >= 300) throw await _errorFrom(response);
    final text = await utf8.decoder.bind(response).join();
    return text.isEmpty ? {} : jsonDecode(text) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> _json(String method, String path,
      {String? token, Map<String, dynamic>? body, Map<String, String>? query, Map<String, String> headers = const {}}) {
    return _guard(() async {
      final request = await _open(method, path, token: token, query: query, headers: headers);
      if (body != null) {
        final bytes = utf8.encode(jsonEncode(body));
        request.headers.contentType = ContentType.json;
        request.contentLength = bytes.length;
        request.add(bytes);
      }
      final response = await request.close().timeout(_timeout);
      return _readJson(response).timeout(_timeout);
    });
  }

  List<LaptopAddress> _addresses(Object? raw) => [
        for (final a in (raw as List<dynamic>? ?? const []))
          LaptopAddress(host: (a as Map<String, dynamic>)['ip'] as String, port: port, kind: a['kind'] as String),
      ];

  Hello _laptop(Object? raw) {
    final map = raw as Map<String, dynamic>;
    return Hello(laptopId: map['id'] as String, name: map['name'] as String);
  }

  // ---- unauthenticated ------------------------------------------------------

  @override
  Future<Hello> hello() async {
    final json = await _json('GET', '/v1/hello');
    return Hello(laptopId: json['laptopId'] as String, name: json['name'] as String);
  }

  @override
  Future<PairRequest> pairRequest({required String deviceId, required String deviceName, required Uint8List commit}) async {
    final json = await _json('POST', '/v1/pair/request', body: {'deviceId': deviceId, 'deviceName': deviceName, 'commit': b64uEncode(commit)});
    return PairRequest(requestId: json['requestId'] as String, nl: b64uDecode(json['nl'] as String, 16));
  }

  @override
  Future<void> pairReveal({required String requestId, required Uint8List np}) async {
    await _json('POST', '/v1/pair/reveal', body: {'requestId': requestId, 'np': b64uEncode(np)});
  }

  @override
  Future<PairStatus> pairStatus({required String requestId, required String deviceId, required String proof}) async {
    final json = await _json('GET', '/v1/pair/status/$requestId', query: {'deviceId': deviceId}, headers: {'x-pair-proof': proof});
    if (json['state'] != 'approved') return const PairStatus.pending();
    return PairStatus.approved(secret: json['secret'] as String, laptop: _laptop(json['laptop']), addresses: _addresses(json['addresses']));
  }

  // ---- sessions -------------------------------------------------------------

  @override
  Future<Session> connect({required String deviceId, required String secret}) async {
    if (_http.pin == null) throw StateError('The device secret must only be sent over a pinned connection.');
    final json = await _json('POST', '/v1/session', headers: {HttpHeaders.authorizationHeader: 'Device $deviceId:$secret'});
    return Session(
      token: json['sessionToken'] as String,
      expiresAt: DateTime.fromMillisecondsSinceEpoch((json['expiresAt'] as num).toInt()),
      laptop: _laptop(json['laptop']),
      addresses: _addresses(json['addresses']),
    );
  }

  @override
  Future<void> disconnect(String token) async {
    await _json('DELETE', '/v1/session', token: token);
  }

  @override
  Future<void> forget(String token) async {
    await _json('DELETE', '/v1/devices/self', token: token);
  }

  // ---- data -----------------------------------------------------------------

  @override
  Future<List<Item>> items(String token) async {
    final json = await _json('GET', '/v1/items', token: token);
    return [for (final i in json['items'] as List<dynamic>) Item.fromJson(i as Map<String, dynamic>)];
  }

  @override
  Future<Item> sendText(String token, String text, String operationId) async {
    return Item.fromJson(await _json('POST', '/v1/text', token: token, body: {'text': text}, headers: {'x-operation-id': operationId}));
  }

  @override
  Future<Item> sendFile(String token, File file, String name, String operationId, {Progress? onProgress}) {
    return _guard(() async {
      final total = await file.length();
      final request = await _open('POST', '/v1/file', token: token, headers: {'x-filename': Uri.encodeComponent(name), 'x-operation-id': operationId});
      request.contentLength = total;
      var sent = 0;
      try {
        await request.addStream(file.openRead().map((chunk) {
          sent += chunk.length;
          onProgress?.call(sent, total);
          return chunk;
        }));
      } on IOException {
        // The laptop may have refused early (for example: too large); its answer is read below.
      }
      return Item.fromJson(await _readJson(await request.close()));
    });
  }

  @override
  Future<File> download(String token, Item item, Directory dir, {Progress? onProgress}) {
    return _guard(() async {
      final request = await _open('GET', '/v1/files/${item.id}', token: token);
      final response = await request.close().timeout(_timeout);
      if (response.statusCode >= 300) throw await _errorFrom(response);
      final file = File('${dir.path}${Platform.pathSeparator}${item.id}');
      final sink = file.openWrite();
      final total = response.contentLength;
      var done = 0;
      try {
        await sink.addStream(response.map((chunk) {
          done += chunk.length;
          onProgress?.call(done, total);
          return chunk;
        }));
      } finally {
        await sink.close();
      }
      return file;
    });
  }

  @override
  Future<void> deleteItem(String token, String id) async {
    await _json('DELETE', '/v1/items/$id', token: token);
  }

  @override
  Stream<SseEvent> events(String token) async* {
    final response = await _guard(() async {
      final request = await _open('GET', '/v1/events', token: token);
      return request.close().timeout(_timeout);
    });
    if (response.statusCode != 200) throw await _errorFrom(response);
    final bytes = response.timeout(_eventSilence, onTimeout: (sink) {
      sink.addError(const Unreachable());
      sink.close();
    }).transform(StreamTransformer<List<int>, List<int>>.fromHandlers(
      handleError: (error, stack, sink) => sink.addError(error is IOException ? const Unreachable() : error, stack),
    ));
    yield* parseSse(bytes);
  }
}
