import '../core/laptop_api.dart';
import '../core/models.dart';
import 'connection.dart';

/// Copies a finished download into the phone's Downloads/FlashPush and returns where it went.
typedef Saver = Future<String> Function(String path, String name);

/// A file name that is safe to hand to Android: only the last path segment.
String safeFileName(String? name) {
  final last = (name ?? '').split(RegExp(r'[\\/]')).last.trim();
  return last.isEmpty ? 'file' : last;
}

/// Downloads [item] from the laptop and saves it to Downloads. The temporary copy is always removed.
Future<String> saveItem(LaptopConnection connection, Item item, {required Saver saver, Progress? onProgress}) async {
  final scratch = await connection.cache.scratch();
  final file = await connection.withSession((api, token) => api.download(token, item, scratch, onProgress: onProgress));
  try {
    return await saver(file.path, safeFileName(item.name));
  } finally {
    if (file.existsSync()) await file.delete();
  }
}
