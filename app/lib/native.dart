import 'dart:async';

import 'package:flutter/services.dart';

class SharedFile {
  SharedFile(this.path, this.name);
  final String path;
  final String name;
}

/// Text and/or files another app shared to FlashPush via the Android share sheet.
class SharePayload {
  SharePayload({this.text, this.files = const []});
  final String? text;
  final List<SharedFile> files;

  factory SharePayload.fromMap(Map<Object?, Object?> map) => SharePayload(
        text: map['text'] as String?,
        files: ((map['files'] as List<Object?>?) ?? [])
            .cast<Map<Object?, Object?>>()
            .map((f) => SharedFile(f['path'] as String, f['name'] as String))
            .toList(),
      );
}

/// Bridge to the Kotlin side (share intents and saving into the public Downloads folder).
class Native {
  Native._() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'onShare') _deliver(SharePayload.fromMap(call.arguments as Map<Object?, Object?>));
    });
  }

  static final Native instance = Native._();

  final MethodChannel _channel = const MethodChannel('flashpush/native');
  final StreamController<SharePayload> _controller = StreamController<SharePayload>.broadcast();
  final List<SharePayload> _pending = [];

  /// Shares that arrived while nobody was listening (e.g. before pairing).
  List<SharePayload> takePending() {
    final list = List<SharePayload>.of(_pending);
    _pending.clear();
    return list;
  }

  Stream<SharePayload> get shares => _controller.stream;

  void _deliver(SharePayload payload) {
    if (_controller.hasListener) {
      _controller.add(payload);
    } else {
      _pending.add(payload);
    }
  }

  /// Call once at startup to pick up the share that launched the app, if any.
  Future<void> loadInitialShare() async {
    final map = await _channel.invokeMethod<Map<Object?, Object?>>('getInitialShare');
    if (map != null) _deliver(SharePayload.fromMap(map));
  }

  /// Copies [path] into Downloads/FlashPush and returns where it went.
  Future<String> saveToDownloads(String path, String name) async {
    final where = await _channel.invokeMethod<String>('saveToDownloads', {'path': path, 'name': name});
    return where ?? name;
  }

  /// A human-readable device name (e.g. "Samsung SM-S938B"), or null if it could not be read.
  Future<String?> deviceModel() async {
    try {
      return await _channel.invokeMethod<String>('getDeviceModel');
    } on Object {
      return null;
    }
  }
}
