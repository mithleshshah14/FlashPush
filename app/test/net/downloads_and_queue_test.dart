import 'dart:io';

import 'package:flashpush/core/errors.dart';
import 'package:flashpush/core/models.dart';
import 'package:flashpush/net/downloads.dart';
import 'package:flashpush/net/transfer_queue.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/connection_harness.dart';

Item image(String id) => Item(id: id, kind: 'file', from: 'laptop', time: DateTime(2026), name: '$id.png', size: 3, mime: 'image/png');

void main() {
  group('imageFile', () {
    test('downloads once, caches the copy, and removes the temporary download', () async {
      final h = await harness();
      await h.connection.connect();
      final file = await h.connection.imageFile(image('img1'));
      expect(file, isNotNull);
      expect(file!.readAsBytesSync(), [1, 2, 3]);
      expect(File(file.path).existsSync(), isTrue);
      final scratch = await h.cache.scratch();
      expect(scratch.listSync(), isEmpty);
      // the second call is served from the cache without another download
      expect((await h.connection.imageFile(image('img1')))!.path, file.path);
      expect(h.network.downloadCalls, 1);
    });

    test('concurrent requests for the same image share one download', () async {
      final h = await harness();
      await h.connection.connect();
      final results = await Future.wait([
        h.connection.imageFile(image('img2')),
        h.connection.imageFile(image('img2')),
        h.connection.imageFile(image('img2')),
      ]);
      expect(results.map((f) => f!.path).toSet().length, 1);
      expect(h.network.downloadCalls, 1);
    });

    test('offline: cached images are available, others are not', () async {
      final h = await harness();
      await h.connection.connect();
      await h.connection.imageFile(image('img3'));
      await h.connection.disconnect();
      expect(await h.connection.imageFile(image('img3')), isNotNull);
      expect(await h.connection.imageFile(image('never-seen')), isNull);
    });
  });

  group('saveItem', () {
    test('hands the download to the saver under a safe name and removes the temporary file', () async {
      final h = await harness();
      await h.connection.connect();
      String? savedPath;
      String? savedName;
      final where = await saveItem(
        h.connection,
        Item(id: 'f1', kind: 'file', from: 'laptop', time: DateTime(2026), name: '..\\..\\evil/report.pdf', size: 3, mime: 'application/pdf'),
        saver: (path, name) async {
          savedPath = path;
          savedName = name;
          expect(File(path).existsSync(), isTrue);
          return 'Downloads/FlashPush/$name';
        },
      );
      expect(savedName, 'report.pdf');
      expect(where, 'Downloads/FlashPush/report.pdf');
      expect(File(savedPath!).existsSync(), isFalse);
    });

    test('the temporary file is removed even when saving fails', () async {
      final h = await harness();
      await h.connection.connect();
      String? savedPath;
      await expectLater(
        saveItem(h.connection, image('f2'), saver: (path, name) async {
          savedPath = path;
          throw Exception('disk full');
        }),
        throwsException,
      );
      expect(File(savedPath!).existsSync(), isFalse);
    });

    test('safeFileName keeps only the last segment and never returns empty', () {
      expect(safeFileName('a/b/c.txt'), 'c.txt');
      expect(safeFileName('a\\b\\c.txt'), 'c.txt');
      expect(safeFileName(''), 'file');
      expect(safeFileName(null), 'file');
      expect(safeFileName('dir/'), 'file');
    });
  });

  group('TransferQueue', () {
    late Directory dir;
    late File file;

    setUp(() async {
      dir = await Directory.systemTemp.createTemp('flashpush-queue-');
      file = File('${dir.path}/a.bin')..writeAsBytesSync([1, 2, 3, 4]);
      addTearDown(() => dir.delete(recursive: true));
    });

    test('an entry appears while sending, shows progress, and disappears on success', () async {
      final h = await harness();
      await h.connection.connect();
      final queue = TransferQueue();
      final seen = <double?>[];
      queue.addListener(() => seen.add(queue.entries.isEmpty ? -1 : queue.entries.single.progress));
      await queue.sendFile(h.connection, file, 'a.bin');
      expect(queue.entries, isEmpty);
      expect(seen.first, 0);
      expect(seen, contains(1.0));
      expect(seen.last, -1);
    });

    test('a failed send stays in the list with a friendly message until dismissed', () async {
      final h = await harness();
      final queue = TransferQueue();
      await queue.sendFile(h.connection, file, 'a.bin'); // not connected
      final entry = queue.entries.single;
      expect(entry.progress, isNull);
      expect(entry.error, 'Connect to the laptop first.');
      queue.dismiss(entry);
      expect(queue.entries, isEmpty);
    });
  });

  test('userMessage explains errors by code', () {
    expect(userMessage(const NotConnected()), contains('Connect'));
    expect(userMessage(const Unreachable()), contains('reach'));
    expect(userMessage(ApiException('PAYLOAD_TOO_LARGE', 413, 'x')), contains('too large'));
    expect(userMessage(ApiException('STORAGE_QUOTA', 507, 'x')), contains('room'));
    expect(userMessage(ApiException('SOMETHING_NEW', 500, 'raw server text')), isNot(contains('raw server text')));
  });
}
