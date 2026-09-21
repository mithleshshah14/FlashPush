import 'dart:io';

import 'package:flutter/material.dart';

import '../core/errors.dart';
import '../net/connection.dart';
import '../net/transfer.dart' as transfer;
import '../net/transfer_queue.dart';
import 'platform_actions.dart';

/// What the round button on the laptop screen does, depending on the tab the user is on.
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

/// Starts sending straight away: the text box for a message, the gallery for an image, the file
/// explorer for a file. Files go through [queue] so the screen shows their progress.
Future<void> startSend(
  BuildContext context,
  SendKind kind, {
  required LaptopConnection connection,
  required TransferQueue queue,
  required PlatformActions actions,
}) async {
  if (kind == SendKind.message) {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _Compose(connection: connection),
    );
    return;
  }
  final files = await actions.pickFiles(imagesOnly: kind == SendKind.image);
  for (final file in files) {
    queue.sendFile(connection, File(file.path), file.name);
  }
}

class _Compose extends StatefulWidget {
  const _Compose({required this.connection});

  final LaptopConnection connection;

  @override
  State<_Compose> createState() => _ComposeState();
}

class _ComposeState extends State<_Compose> {
  final _field = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _field.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _field.text;
    if (text.trim().isEmpty) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await transfer.sendText(widget.connection, text);
      if (mounted) Navigator.of(context).pop();
    } on Object catch (error) {
      if (mounted) {
        setState(() {
          _sending = false;
          _error = userMessage(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 24, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('New message', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          TextField(
            key: const Key('text-field'),
            controller: _field,
            autofocus: true,
            minLines: 3,
            maxLines: 8,
            decoration: InputDecoration(hintText: 'Type a message or paste a link', errorText: _error),
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              key: const Key('send-text'),
              onPressed: _sending ? null : _send,
              icon: _sending ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send),
              label: const Text('Send'),
            ),
          ),
        ],
      ),
    );
  }
}
