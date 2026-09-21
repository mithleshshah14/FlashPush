import 'package:flutter/material.dart';

import '../core/errors.dart';
import '../core/models.dart';
import '../net/connection.dart';
import '../net/downloads.dart';
import '../theme.dart';
import 'empty_tab.dart';
import 'format.dart';

/// Documents and other files, both directions, each with Save to Downloads.
class FileList extends StatelessWidget {
  const FileList({super.key, required this.connection, required this.items, required this.saver});

  final LaptopConnection connection;
  final List<Item> items;
  final Saver saver;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const EmptyTab(icon: Icons.insert_drive_file_outlined, text: 'No files yet');
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
      itemCount: items.length,
      separatorBuilder: (context, index) => const SizedBox(height: 8),
      itemBuilder: (context, index) => _FileTile(key: ValueKey(items[index].id), connection: connection, item: items[index], saver: saver),
    );
  }
}

IconData _iconFor(String? mime) {
  final type = mime ?? '';
  if (type == 'application/pdf') return Icons.picture_as_pdf_outlined;
  if (type.startsWith('video/')) return Icons.movie_outlined;
  if (type.startsWith('audio/')) return Icons.audiotrack_outlined;
  if (type.startsWith('text/')) return Icons.description_outlined;
  return Icons.insert_drive_file_outlined;
}

class _FileTile extends StatefulWidget {
  const _FileTile({super.key, required this.connection, required this.item, required this.saver});

  final LaptopConnection connection;
  final Item item;
  final Saver saver;

  @override
  State<_FileTile> createState() => _FileTileState();
}

class _FileTileState extends State<_FileTile> {
  double? _progress;
  bool _saving = false;

  Future<void> _save() async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _saving = true;
      _progress = 0;
    });
    try {
      final where = await saveItem(widget.connection, widget.item, saver: widget.saver, onProgress: (done, total) {
        if (mounted && total > 0) setState(() => _progress = done / total);
      });
      messenger.showSnackBar(SnackBar(content: Text('Saved to $where')));
    } on Object catch (error) {
      messenger.showSnackBar(SnackBar(content: Text(userMessage(error))));
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
          _progress = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final item = widget.item;
    return Card(
      child: ListTile(
        leading: Icon(_iconFor(item.mime), color: context.flash.cyan),
        title: Text(item.name ?? 'file', overflow: TextOverflow.ellipsis),
        subtitle: _saving
            ? LinearProgressIndicator(value: _progress)
            : Text(
                '${formatBytes(item.size)}  ·  ${item.fromLaptop ? 'From laptop' : 'Sent'}  ·  ${dayLabel(item.time)} ${clockTime(item.time)}',
                style: theme.textTheme.bodySmall?.copyWith(fontFamily: monoFamily),
              ),
        trailing: IconButton(icon: const Icon(Icons.download), tooltip: 'Save to Downloads', onPressed: _saving ? null : _save),
      ),
    );
  }
}
