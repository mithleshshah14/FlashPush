import 'package:file_picker/file_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../native.dart';

class PickedFile {
  const PickedFile(this.path, this.name);

  final String path;
  final String name;
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
          return [for (final f in files) if (f.path != null) PickedFile(f.path!, f.name)];
        },
        saveToDownloads: (path, name) => Native.instance.saveToDownloads(path, name),
        openLink: (url) => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
      );
}
