import 'dart:convert';

/// One server-sent event: a name plus its JSON object.
class SseEvent {
  const SseEvent(this.event, this.data);

  final String event;
  final Map<String, dynamic> data;
}

/// Parses `event:` / `data:` blocks; comment lines (heartbeats) and malformed blocks are skipped.
Stream<SseEvent> parseSse(Stream<List<int>> bytes) async* {
  var buffer = '';
  await for (final chunk in utf8.decoder.bind(bytes)) {
    buffer += chunk;
    int end;
    while ((end = buffer.indexOf('\n\n')) != -1) {
      final block = buffer.substring(0, end);
      buffer = buffer.substring(end + 2);
      final event = _parseBlock(block);
      if (event != null) yield event;
    }
  }
}

SseEvent? _parseBlock(String block) {
  String? name;
  String? data;
  for (final line in block.split('\n')) {
    if (line.startsWith('event: ')) name = line.substring(7);
    if (line.startsWith('data: ')) data = line.substring(6);
  }
  if (name == null || data == null) return null;
  try {
    final decoded = jsonDecode(data);
    return decoded is Map<String, dynamic> ? SseEvent(name, decoded) : null;
  } on FormatException {
    return null;
  }
}
