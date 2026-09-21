import 'dart:io';

import 'package:flutter/material.dart';

import '../core/errors.dart';
import '../net/connection.dart';
import '../net/transfer.dart' as transfer;
import '../net/transfer_queue.dart';
import '../theme.dart';
import 'platform_actions.dart';

enum _Kind { image, text, document }

/// "New transfer": first ask what to send (Image, Text or Document), then pick or compose it.
/// Files go through [queue] so the detail screen shows their progress.
Future<void> showNewTransferSheet(
  BuildContext context, {
  required LaptopConnection connection,
  required TransferQueue queue,
  required PlatformActions actions,
}) async {
  final kind = await showModalBottomSheet<_Kind>(
    context: context,
    builder: (_) => const _ChooseType(),
  );
  if (kind == null || !context.mounted) return;
  switch (kind) {
    case _Kind.text:
      await _compose(context, connection);
    case _Kind.image:
    case _Kind.document:
      final files = await actions.pickFiles(imagesOnly: kind == _Kind.image);
      for (final file in files) {
        queue.sendFile(connection, File(file.path), file.name);
      }
  }
}

class _ChooseType extends StatelessWidget {
  const _ChooseType();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('What do you want to send?', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            _Choice(key: const Key('choice-image'), icon: Icons.image_outlined, title: 'Image', subtitle: 'From your gallery', kind: _Kind.image),
            const SizedBox(height: 8),
            _Choice(key: const Key('choice-text'), icon: Icons.notes, title: 'Text', subtitle: 'Write a message or paste a link', kind: _Kind.text),
            const SizedBox(height: 8),
            _Choice(key: const Key('choice-document'), icon: Icons.insert_drive_file_outlined, title: 'Document', subtitle: 'Any file', kind: _Kind.document),
          ],
        ),
      ),
    );
  }
}

class _Choice extends StatelessWidget {
  const _Choice({super.key, required this.icon, required this.title, required this.subtitle, required this.kind});

  final IconData icon;
  final String title;
  final String subtitle;
  final _Kind kind;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(icon, color: context.flash.cyan, size: 32),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.of(context).pop(kind),
      ),
    );
  }
}

Future<void> _compose(BuildContext context, LaptopConnection connection) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _Compose(connection: connection),
  );
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
          Text('Send text', style: Theme.of(context).textTheme.titleLarge),
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
