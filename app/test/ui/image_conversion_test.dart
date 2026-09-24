import 'dart:io';

import 'package:flashpush/ui/platform_actions.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';

class FakePathProvider extends PathProviderPlatform {
  @override
  Future<String?> getTemporaryPath() async => Directory.systemTemp.path;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  PathProviderPlatform.instance = FakePathProvider();

  test('BMP gets converted to a JPG', () async {
    final bmp = img.encodeBmp(img.Image(width: 4, height: 4));
    final source = File('${Directory.systemTemp.path}/probe.bmp')..writeAsBytesSync(bmp);

    final result = await convertImageToJpgIfNeeded(PickedFile(source.path, 'probe.bmp'));

    expect(result.name, 'probe.jpg');
    expect(img.decodeJpg(File(result.path).readAsBytesSync()), isNotNull);
    source.deleteSync();
    File(result.path).deleteSync();
  });

  test('PNG and GIF pass through untouched', () async {
    final png = File('${Directory.systemTemp.path}/probe.png');
    final result = await convertImageToJpgIfNeeded(PickedFile(png.path, 'probe.png'));
    expect(result.path, png.path);
    expect(result.name, 'probe.png');
  });
}
