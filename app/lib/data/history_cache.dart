import 'dart:convert';
import 'dart:io';

import '../core/models.dart';

/// Per-laptop history kept on the phone so Messages, Images and Files are readable offline.
/// Received images are cached as files (bounded, oldest evicted first).
class HistoryCache {
  HistoryCache(this.root, {this.maxImageBytes = 100 * 1024 * 1024});

  final Directory root;
  final int maxImageBytes;

  static final _safeId = RegExp(r'^[\w-]{1,64}$');

  // Ids come from the laptop, so they are checked before they become part of a path.
  Directory _dir(String laptopId) {
    if (!_safeId.hasMatch(laptopId)) throw ArgumentError('Unsafe id');
    return Directory('${root.path}${Platform.pathSeparator}$laptopId');
  }

  File _itemsFile(String laptopId) => File('${_dir(laptopId).path}${Platform.pathSeparator}items.json');

  Future<List<Item>> load(String laptopId) async {
    try {
      final list = jsonDecode(await _itemsFile(laptopId).readAsString()) as List<dynamic>;
      return [for (final i in list) Item.fromJson(i as Map<String, dynamic>)];
    } on Object {
      return const []; // missing or damaged: start empty, the laptop is the source of truth
    }
  }

  Future<void> save(String laptopId, List<Item> items) async {
    final file = _itemsFile(laptopId);
    await file.parent.create(recursive: true);
    await file.writeAsString(jsonEncode([for (final i in items) i.toJson()]));
  }

  File imageFile(String laptopId, String itemId) {
    if (!_safeId.hasMatch(itemId)) throw ArgumentError('Unsafe id');
    return File('${_dir(laptopId).path}${Platform.pathSeparator}images${Platform.pathSeparator}$itemId');
  }

  /// Copies [source] into the cache, then evicts the oldest images beyond the size limit.
  Future<File> storeImage(String laptopId, String itemId, File source) async {
    final target = imageFile(laptopId, itemId);
    await target.parent.create(recursive: true);
    await source.copy(target.path);
    await target.setLastModified(DateTime.now()); // copy keeps the source's time; eviction order is caching order
    await _trim(target.parent);
    return target;
  }

  Future<void> _trim(Directory images) async {
    final files = [
      for (final e in await images.list().toList())
        if (e is File) (file: e, stat: await e.stat()),
    ]..sort((a, b) => a.stat.modified.compareTo(b.stat.modified));
    var total = files.fold<int>(0, (sum, f) => sum + f.stat.size);
    for (final f in files) {
      if (total <= maxImageBytes) break;
      await f.file.delete();
      total -= f.stat.size;
    }
  }

  Future<void> clear(String laptopId) async {
    final dir = _dir(laptopId);
    if (await dir.exists()) await dir.delete(recursive: true);
  }
}
