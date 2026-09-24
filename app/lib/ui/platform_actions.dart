import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:image/image.dart' as img;
import 'package:path_provider/path_provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../native.dart';

class PickedFile {
  const PickedFile(this.path, this.name);

  final String path;
  final String name;
}

/// Formats sent as-is: PNG and GIF keep transparency/animation, JPG needs no re-encoding.
const _formatsKeptAsIs = {'png', 'gif', 'jpg', 'jpeg'};

/// Re-encodes anything that isn't already JPG/PNG/GIF (e.g. HEIC, WEBP, BMP) to a high-quality
/// JPG before it's sent, so the receiving side only ever deals with a handful of formats.
/// Falls back to the original file if decoding fails.
Future<PickedFile> convertImageToJpgIfNeeded(PickedFile file) async {
  final ext = file.name.split('.').last.toLowerCase();
  if (_formatsKeptAsIs.contains(ext)) return file;

  final decoded = img.decodeImage(await File(file.path).readAsBytes());
  if (decoded == null) return file;

  final jpgBytes = img.encodeJpg(decoded, quality: 95);
  final tempDir = await getTemporaryDirectory();
  final baseName = file.name.contains('.') ? file.name.substring(0, file.name.lastIndexOf('.')) : file.name;
  final jpgName = '$baseName.jpg';
  final jpgPath = '${tempDir.path}/$jpgName';
  await File(jpgPath).writeAsBytes(jpgBytes);
  return PickedFile(jpgPath, jpgName);
}

/// Everything the screens need from the Android platform, in one place so tests can replace it.
class PlatformActions {
  const PlatformActions({required this.pickFiles, required this.saveToDownloads, required this.openLink});

  /// Opens the system picker; images only when [imagesOnly]. Empty when the user cancels.
  final Future<List<PickedFile>> Function({required bool imagesOnly}) pickFiles;

  /// Copies a finished download into Downloads/FlashPush and returns where it went.
  final Future<String> Function(String path, String name) saveToDownloads;

  /// Opens an http(s) link in the browser; false when nothing could open it.
  final Future<bool> Function(String url) openLink;

  factory PlatformActions.system() => PlatformActions(
        pickFiles: ({required bool imagesOnly}) async {
          final files = await FilePicker.pickFiles(type: imagesOnly ? FileType.image : FileType.any);
          final picked = [for (final f in files) if (f.path != null) PickedFile(f.path!, f.name)];
          if (!imagesOnly) return picked;
          return [for (final f in picked) await convertImageToJpgIfNeeded(f)];
        },
        saveToDownloads: (path, name) => Native.instance.saveToDownloads(path, name),
        openLink: (url) => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
      );
}
