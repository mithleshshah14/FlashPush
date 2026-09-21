import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

// The launcher icon comes from the brand artwork (scripts/make-android-icons.py). This guards against the
// default Flutter icon coming back (for example after `flutter create` or a resource merge).
final res = Directory('android/app/src/main/res');

/// Width and height from a PNG header.
({int width, int height}) pngSize(File file) {
  final bytes = file.readAsBytesSync();
  expect(bytes.sublist(0, 8), [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], reason: '${file.path} is a PNG');
  final header = ByteData.sublistView(bytes, 16, 24);
  return (width: header.getUint32(0), height: header.getUint32(4));
}

void main() {
  const legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192};
  const adaptive = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432};

  test('every density has a launcher icon of the right size', () {
    legacy.forEach((density, size) {
      final png = pngSize(File('${res.path}/mipmap-$density/ic_launcher.png'));
      expect((png.width, png.height), (size, size), reason: density);
    });
  });

  test('every density has an adaptive-icon foreground of the right size', () {
    adaptive.forEach((density, size) {
      final png = pngSize(File('${res.path}/mipmap-$density/ic_launcher_foreground.png'));
      expect((png.width, png.height), (size, size), reason: density);
    });
  });

  test('the adaptive icon uses the generated foreground and background', () {
    final xml = File('${res.path}/mipmap-anydpi-v26/ic_launcher.xml').readAsStringSync();
    expect(xml, contains('@mipmap/ic_launcher_foreground'));
    expect(xml, contains('@drawable/ic_launcher_background'));
    expect(File('${res.path}/drawable/ic_launcher_background.xml').readAsStringSync(), contains('#112B58'));
  });

  test('the manifest points at the launcher icon', () {
    final manifest = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
    expect(manifest, contains('android:icon="@mipmap/ic_launcher"'));
  });
}
