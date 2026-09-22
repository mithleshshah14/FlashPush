import 'dart:io';

import 'package:flutter/material.dart';

import '../net/connection.dart';
import '../net/transfer_queue.dart';
import 'platform_actions.dart';

/// What the round button on the laptop screen does, depending on the tab the user is on.
/// Messages has no button of its own: it sends through its own composer (see [MessageComposer]).
enum SendKind {
  message(label: 'New message', icon: Icons.edit_outlined, key: 'send-message'),
  image(label: 'Send image', icon: Icons.add_photo_alternate_outlined, key: 'send-image'),
  file(label: 'Send file', icon: Icons.attach_file, key: 'send-file');

  const SendKind({required this.label, required this.icon, required this.key});

  final String label;
  final IconData icon;
  final String key;

  /// The tab order is Messages, Images, Files.
  static SendKind forTab(int index) => values[index];
}

/// Opens the gallery for an image or the file explorer for a file. Files go through [queue] so
/// the screen shows their progress. Never called for [SendKind.message].
Future<void> startSend(
  BuildContext context,
  SendKind kind, {
  required LaptopConnection connection,
  required TransferQueue queue,
  required PlatformActions actions,
}) async {
  final files = await actions.pickFiles(imagesOnly: kind == SendKind.image);
  for (final file in files) {
    queue.sendFile(connection, File(file.path), file.name);
  }
}
