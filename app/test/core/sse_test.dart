import 'dart:convert';

import 'package:flashpush/core/sse.dart';
import 'package:flutter_test/flutter_test.dart';

Stream<List<int>> chunks(List<String> parts) => Stream.fromIterable(parts.map(utf8.encode));

Future<List<SseEvent>> parse(List<String> parts) => parseSse(chunks(parts)).toList();

void main() {
  test('two events in one chunk', () async {
    final events = await parse(['event: item-added\ndata: {"id":"1"}\n\nevent: item-deleted\ndata: {"id":"1"}\n\n']);
    expect(events.map((e) => e.event), ['item-added', 'item-deleted']);
    expect(events.first.data['id'], '1');
  });

  test('one event split over several chunks, even inside a multi-byte character', () async {
    final bytes = utf8.encode('event: item-added\ndata: {"text":"héllo"}\n\n');
    final split = bytes.indexOf(0xC3) + 1; // between the two bytes of "é"
    final events = await parseSse(Stream.fromIterable([bytes.sublist(0, split), bytes.sublist(split)])).toList();
    expect(events.single.data['text'], 'héllo');
  });

  test('comments (heartbeats) and the connected line are ignored', () async {
    final events = await parse([': connected\n\n: ping\n\nevent: expired\ndata: {"reason":"revoked"}\n\n']);
    expect(events.single.event, 'expired');
    expect(events.single.data['reason'], 'revoked');
  });

  test('blocks with invalid JSON or without an event name are skipped', () async {
    final events = await parse(['event: item-added\ndata: {nope\n\ndata: {"a":1}\n\nevent: x\ndata: [1]\n\nevent: ok\ndata: {}\n\n']);
    expect(events.map((e) => e.event), ['ok']);
  });

  test('an unfinished block at the end of the stream is not delivered', () async {
    expect(await parse(['event: item-added\ndata: {"id":"1"}']), isEmpty);
  });
}
