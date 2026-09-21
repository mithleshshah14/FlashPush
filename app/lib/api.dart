import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

/// Where the laptop server lives and the secret needed to talk to it.
class Connection {
  const Connection(this.baseUrl, this.token);

  final String baseUrl; // e.g. http://192.168.1.6:8765
  final String token;

  /// Accepts the link from the QR code / laptop page, e.g. `http://192.168.1.6:8765/?t=abc123`.
  static Connection? parse(String input) {
    var text = input.trim();
    if (text.isEmpty) return null;
    if (!text.contains('://')) text = 'http://$text';
    final uri = Uri.tryParse(text);
    final token = uri?.queryParameters['t'];
    if (uri == null || uri.host.isEmpty || token == null || token.isEmpty) return null;
    final port = uri.hasPort ? uri.port : 80;
    return Connection('${uri.scheme}://${uri.host}:$port', token);
  }
}

class Item {
  Item({
    required this.id,
    required this.kind,
    required this.from,
    required this.time,
    this.text,
    this.name,
    this.size,
  });

  final String id;
  final String kind; // 'text' | 'file'
  final String from; // 'phone' | 'laptop'
  final DateTime time;
  final String? text;
  final String? name;
  final int? size;

  bool get isText => kind == 'text';
  bool get fromLaptop => from == 'laptop';

  factory Item.fromJson(Map<String, dynamic> json) => Item(
        id: json['id'] as String,
        kind: json['kind'] as String,
        from: json['from'] as String,
        time: DateTime.fromMillisecondsSinceEpoch((json['time'] as num).toInt()),
        text: json['text'] as String?,
        name: json['name'] as String?,
        size: (json['size'] as num?)?.toInt(),
      );
}

sealed class ItemEvent {}

class ItemAdded extends ItemEvent {
  ItemAdded(this.item);
  final Item item;
}

class ItemDeleted extends ItemEvent {
  ItemDeleted(this.id);
  final String id;
}

class ApiException implements Exception {
  ApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

typedef Progress = void Function(int done, int total);

class FlashPushApi {
  FlashPushApi(this.connection);

  final Connection connection;
  final http.Client _http = http.Client();
  final http.Client _eventsHttp = http.Client();

  Uri _uri(String path) => Uri.parse('${connection.baseUrl}$path');
  Map<String, String> get _headers => {'X-Token': connection.token};

  /// Returns null when the server is a valid FlashPush server, otherwise a reason.
  Future<String?> check() async {
    try {
      final res = await _http.get(_uri('/api/ping'), headers: _headers).timeout(const Duration(seconds: 5));
      if (res.statusCode == 401) return 'The link is not valid (wrong token). Scan the QR code again.';
      if (res.statusCode == 200 && res.body.contains('flashpush')) return null;
      return 'That address is not a FlashPush server.';
    } on TimeoutException {
      return 'Could not reach the laptop. Make sure both are on the same Wi-Fi and the firewall allows Node.js.';
    } catch (_) {
      return 'Could not reach the laptop. Make sure both are on the same Wi-Fi and the server is running.';
    }
  }

  Future<List<Item>> items() async {
    final res = await _http.get(_uri('/api/items'), headers: _headers).timeout(const Duration(seconds: 10));
    if (res.statusCode != 200) throw ApiException('Server returned ${res.statusCode}');
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.map((e) => Item.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> sendText(String text) async {
    final res = await _http
        .post(
          _uri('/api/text'),
          headers: {..._headers, 'Content-Type': 'application/json'},
          body: jsonEncode({'text': text, 'from': 'phone'}),
        )
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 201) throw ApiException('Could not send text (${res.statusCode})');
  }

  Future<void> sendFile(File file, String name, {Progress? onProgress}) async {
    final total = await file.length();
    final req = http.StreamedRequest('POST', _uri('/api/file'))
      ..contentLength = total
      ..headers.addAll({
        ..._headers,
        'X-Filename': Uri.encodeComponent(name),
        'X-From': 'phone',
        'Content-Type': 'application/octet-stream',
      });

    final response = _http.send(req)..ignore(); // errors surface below when awaited
    var sent = 0;
    try {
      await req.sink.addStream(file.openRead().map((chunk) {
        sent += chunk.length;
        onProgress?.call(sent, total);
        return chunk;
      }));
      await req.sink.close();
    } catch (_) {
      // The real cause (e.g. connection refused) is reported by the response future.
    }
    final res = await response;
    await res.stream.drain<void>();
    if (res.statusCode != 201) throw ApiException('Upload failed (${res.statusCode})');
  }

  /// Downloads an item's file into [dir] and returns it.
  Future<File> download(Item item, Directory dir, {Progress? onProgress}) async {
    final res = await _http.send(http.Request('GET', _uri('/files/${item.id}'))..headers.addAll(_headers));
    if (res.statusCode != 200) {
      await res.stream.drain<void>();
      throw ApiException('Download failed (${res.statusCode})');
    }
    final file = File('${dir.path}${Platform.pathSeparator}${item.id}');
    final sink = file.openWrite();
    final total = res.contentLength ?? item.size ?? 0;
    var done = 0;
    try {
      await sink.addStream(res.stream.map((chunk) {
        done += chunk.length;
        onProgress?.call(done, total);
        return chunk;
      }));
    } finally {
      await sink.close();
    }
    return file;
  }

  Future<void> delete(String id) async {
    final res = await _http.delete(_uri('/api/items/$id'), headers: _headers).timeout(const Duration(seconds: 10));
    if (res.statusCode != 200 && res.statusCode != 404) throw ApiException('Delete failed (${res.statusCode})');
  }

  /// Live add/delete events. Ends (or errors) when the connection drops; callers reconnect.
  Stream<ItemEvent> events() async* {
    final req = http.Request('GET', _uri('/api/events'))
      ..headers.addAll({..._headers, 'Accept': 'text/event-stream'});
    final res = await _eventsHttp.send(req).timeout(const Duration(seconds: 10));
    if (res.statusCode != 200) throw ApiException('Events returned ${res.statusCode}');

    // The server sends a heartbeat every 25s, so 60s of silence means the link is dead.
    final bytes = res.stream.timeout(
      const Duration(seconds: 60),
      onTimeout: (sink) => sink.addError(TimeoutException('Lost connection')),
    );
    await for (final line in bytes.transform(utf8.decoder).transform(const LineSplitter())) {
      if (!line.startsWith('data: ')) continue;
      final json = jsonDecode(line.substring(6)) as Map<String, dynamic>;
      switch (json['type']) {
        case 'add':
          yield ItemAdded(Item.fromJson(json['item'] as Map<String, dynamic>));
        case 'delete':
          yield ItemDeleted(json['id'] as String);
      }
    }
  }

  void close() {
    _http.close();
    _eventsHttp.close();
  }
}
