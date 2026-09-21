import 'package:flashpush/native.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const _channel = 'flashpush/native';

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();

  void mockPlatform(Future<Object?> Function(MethodCall call) handler) {
    binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel(_channel), handler);
    addTearDown(() => binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel(_channel), null));
  }

  Future<void> platformCalls(String method, Object? arguments) async {
    const codec = StandardMethodCodec();
    await binding.defaultBinaryMessenger.handlePlatformMessage(_channel, codec.encodeMethodCall(MethodCall(method, arguments)), (_) {});
  }

  test('a share that launched the app is picked up at start, once', () async {
    mockPlatform((call) async {
      expect(call.method, 'getInitialShare');
      return {
        'text': 'https://example.com',
        'files': [
          {'path': '/cache/shared/1_photo.jpg', 'name': 'photo.jpg'},
        ],
      };
    });
    await Native.instance.loadInitialShare();
    final pending = Native.instance.takePending();
    expect(pending.single.text, 'https://example.com');
    expect(pending.single.files.single.name, 'photo.jpg');
    expect(pending.single.files.single.path, '/cache/shared/1_photo.jpg');
    expect(Native.instance.takePending(), isEmpty, reason: 'taken shares are not delivered twice');
  });

  test('no share at start means nothing pending', () async {
    mockPlatform((call) async => null);
    await Native.instance.loadInitialShare();
    expect(Native.instance.takePending(), isEmpty);
  });

  test('a share that arrives while the app is open goes to the listener', () async {
    final received = <SharePayload>[];
    final subscription = Native.instance.shares.listen(received.add);
    addTearDown(subscription.cancel);
    await platformCalls('onShare', {'text': 'hello', 'files': <Object?>[]});
    await Future<void>.delayed(Duration.zero);
    expect(received.single.text, 'hello');
    expect(received.single.files, isEmpty);
  });

  test('shares with no listener wait until someone asks for them', () async {
    await platformCalls('onShare', {'text': 'early', 'files': <Object?>[]});
    expect(Native.instance.takePending().single.text, 'early');
  });

  test('saveToDownloads passes the path and name and returns where it went', () async {
    mockPlatform((call) async {
      expect(call.method, 'saveToDownloads');
      expect(call.arguments, {'path': '/cache/tmp/abc', 'name': 'report.pdf'});
      return 'Downloads/FlashPush/report.pdf';
    });
    expect(await Native.instance.saveToDownloads('/cache/tmp/abc', 'report.pdf'), 'Downloads/FlashPush/report.pdf');
  });

  test('saveToDownloads falls back to the name when the platform gives no location', () async {
    mockPlatform((call) async => null);
    expect(await Native.instance.saveToDownloads('/x', 'a.txt'), 'a.txt');
  });
}
