import 'package:flashpush/ui/platform_actions.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const _channel = 'flashpush/native';

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();

  void mockPlatform(Future<Object?> Function(MethodCall call) handler) {
    binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel(_channel), handler);
    addTearDown(() => binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel(_channel), null));
  }

  test('a HEIC (or other non-JPG/PNG/GIF) file is sent through the native converter', () async {
    mockPlatform((call) async {
      expect(call.method, 'convertToJpg');
      expect(call.arguments, {'path': '/cache/shared/photo.heic'});
      return '/cache/jpg_123_photo.jpg';
    });
    final result = await convertImageToJpgIfNeeded(const PickedFile('/cache/shared/photo.heic', 'photo.heic'));
    expect(result.path, '/cache/jpg_123_photo.jpg');
    expect(result.name, 'photo.jpg');
  });

  test('PNG and GIF pass through untouched, no native call made', () async {
    mockPlatform((call) async => throw StateError('should not be called for ${call.method}'));
    final png = const PickedFile('/cache/shared/probe.png', 'probe.png');
    expect(await convertImageToJpgIfNeeded(png), same(png));
  });

  test('falls back to the original file if the OS could not decode it', () async {
    mockPlatform((call) async => null);
    final source = const PickedFile('/cache/shared/mystery.xyz', 'mystery.xyz');
    final result = await convertImageToJpgIfNeeded(source);
    expect(result.path, source.path);
    expect(result.name, source.name);
  });
}
