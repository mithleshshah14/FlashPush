import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';
import 'native.dart';

class _Transfer {
  _Transfer(this.label);
  final String label;
  double? progress = 0;
  String? error;
}

class HomePage extends StatefulWidget {
  const HomePage({super.key, required this.connection, required this.onDisconnect});

  final Connection connection;
  final VoidCallback onDisconnect;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  late final FlashPushApi _api = FlashPushApi(widget.connection);
  final _input = TextEditingController();
  final List<Item> _items = [];
  final List<_Transfer> _transfers = [];
  StreamSubscription<SharePayload>? _shareSub;
  bool _connected = false;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    _listen();
    for (final payload in Native.instance.takePending()) {
      _handleShare(payload);
    }
    _shareSub = Native.instance.shares.listen(_handleShare);
  }

  @override
  void dispose() {
    _disposed = true;
    _shareSub?.cancel();
    _input.dispose();
    _api.close();
    super.dispose();
  }

  // ------------------------------------------------------------ live sync

  Future<void> _listen() async {
    while (!_disposed) {
      try {
        final list = await _api.items();
        if (_disposed) return;
        setState(() {
          _items
            ..clear()
            ..addAll(list);
          _connected = true;
        });
        await for (final event in _api.events()) {
          if (_disposed) return;
          setState(() {
            switch (event) {
              case ItemAdded(:final item):
                if (_items.every((i) => i.id != item.id)) _items.add(item);
              case ItemDeleted(:final id):
                _items.removeWhere((i) => i.id == id);
            }
          });
        }
      } catch (_) {
        // Fall through to the reconnect delay below.
      }
      if (_disposed) return;
      setState(() => _connected = false);
      await Future<void>.delayed(const Duration(seconds: 2));
    }
  }

  // ------------------------------------------------------------ sending

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _sendText([String? override]) async {
    final text = override ?? _input.text;
    if (text.trim().isEmpty) return;
    try {
      await _api.sendText(text);
      if (override == null) _input.clear();
    } catch (e) {
      _toast('Could not send: $e');
    }
  }

  Future<void> _pickAndSend() async {
    final files = await FilePicker.pickFiles();
    for (final f in files) {
      final path = f.path;
      if (path != null) unawaited(_uploadFile(File(path), f.name));
    }
  }

  Future<void> _uploadFile(File file, String name) async {
    final transfer = _Transfer(name);
    setState(() => _transfers.add(transfer));
    try {
      await _api.sendFile(file, name, onProgress: (sent, total) {
        if (!mounted || total == 0) return;
        setState(() => transfer.progress = sent / total);
      });
      if (mounted) setState(() => _transfers.remove(transfer));
    } catch (e) {
      if (mounted) {
        setState(() {
          transfer.progress = null;
          transfer.error = 'Failed: $e';
        });
      }
    }
  }

  Future<void> _handleShare(SharePayload payload) async {
    final text = payload.text;
    if (text != null && text.trim().isNotEmpty) {
      await _sendText(text);
      _toast('Sent to laptop');
    }
    for (final f in payload.files) {
      unawaited(_uploadFile(File(f.path), f.name));
    }
  }

  // ------------------------------------------------------------ item actions

  Future<void> _download(Item item) async {
    final transfer = _Transfer(item.name ?? 'file');
    setState(() => _transfers.add(transfer));
    try {
      final file = await _api.download(item, Directory.systemTemp, onProgress: (done, total) {
        if (!mounted || total == 0) return;
        setState(() => transfer.progress = done / total);
      });
      final where = await Native.instance.saveToDownloads(file.path, item.name ?? 'file');
      await file.delete();
      if (mounted) setState(() => _transfers.remove(transfer));
      _toast('Saved to $where');
    } catch (e) {
      if (mounted) {
        setState(() {
          transfer.progress = null;
          transfer.error = 'Failed: $e';
        });
      }
    }
  }

  Future<void> _delete(Item item) async {
    try {
      await _api.delete(item.id);
    } catch (e) {
      _toast('Could not delete: $e');
    }
  }

  Future<void> _copy(Item item) async {
    await Clipboard.setData(ClipboardData(text: item.text ?? ''));
    _toast('Copied');
  }

  Future<void> _openLink(String url) async {
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!ok) _toast('Could not open link');
  }

  // ------------------------------------------------------------ UI

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final host = Uri.parse(widget.connection.baseUrl).host;
    final ordered = _items.reversed.toList();

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('FlashPush', style: TextStyle(fontWeight: FontWeight.w700)),
            Row(
              children: [
                Icon(Icons.circle, size: 9, color: _connected ? Colors.green : theme.colorScheme.outline),
                const SizedBox(width: 6),
                Text(
                  _connected ? 'Connected to $host' : 'Reconnecting to $host...',
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
          ],
        ),
        actions: [
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'disconnect') widget.onDisconnect();
            },
            itemBuilder: (_) => const [PopupMenuItem(value: 'disconnect', child: Text('Disconnect from laptop'))],
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ordered.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32),
                      child: Text(
                        'Nothing yet.\nType below, attach a file, or share something to FlashPush from any app.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.outline),
                      ),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                    itemCount: ordered.length,
                    itemBuilder: (_, i) => _ItemCard(
                      item: ordered[i],
                      onCopy: _copy,
                      onDownload: _download,
                      onDelete: _delete,
                      onOpenLink: _openLink,
                    ),
                  ),
          ),
          for (final t in _transfers)
            ListTile(
              dense: true,
              title: Text(t.label, maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: t.error != null
                  ? Text(t.error!, style: TextStyle(color: theme.colorScheme.error))
                  : LinearProgressIndicator(value: t.progress),
              trailing: t.error != null
                  ? IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _transfers.remove(t)))
                  : null,
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
              child: Row(
                children: [
                  IconButton(
                    tooltip: 'Attach files',
                    icon: const Icon(Icons.attach_file),
                    onPressed: _pickAndSend,
                  ),
                  Expanded(
                    child: TextField(
                      controller: _input,
                      minLines: 1,
                      maxLines: 5,
                      textInputAction: TextInputAction.newline,
                      decoration: InputDecoration(
                        hintText: 'Send text or a link to your laptop',
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(24)),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  IconButton.filled(
                    tooltip: 'Send',
                    icon: const Icon(Icons.send),
                    onPressed: _sendText,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ItemCard extends StatelessWidget {
  const _ItemCard({
    required this.item,
    required this.onCopy,
    required this.onDownload,
    required this.onDelete,
    required this.onOpenLink,
  });

  final Item item;
  final void Function(Item) onCopy;
  final void Function(Item) onDownload;
  final void Function(Item) onDelete;
  final void Function(String) onOpenLink;

  static final _urlPattern = RegExp(r'https?://[^\s]+');

  static String _size(int? bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1048576) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1073741824) return '${(bytes / 1048576).toStringAsFixed(1)} MB';
    return '${(bytes / 1073741824).toStringAsFixed(2)} GB';
  }

  static String _time(DateTime t) {
    final hm = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    final now = DateTime.now();
    final today = t.year == now.year && t.month == now.month && t.day == now.day;
    return today ? hm : '${t.day}/${t.month} $hm';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fromLaptop = item.fromLaptop;
    final link = item.isText ? _urlPattern.firstMatch(item.text ?? '')?.group(0) : null;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      elevation: 0,
      color: fromLaptop ? theme.colorScheme.secondaryContainer : theme.colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${fromLaptop ? 'From laptop' : 'Sent to laptop'}  ·  ${_time(item.time)}',
              style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.outline),
            ),
            const SizedBox(height: 6),
            if (item.isText)
              SelectableText(item.text ?? '', style: theme.textTheme.bodyLarge)
            else
              Row(
                children: [
                  const Icon(Icons.insert_drive_file_outlined),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.name ?? 'file', style: theme.textTheme.titleSmall),
                        Text(_size(item.size), style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ),
                ],
              ),
            const SizedBox(height: 4),
            Row(
              children: [
                if (item.isText) TextButton.icon(onPressed: () => onCopy(item), icon: const Icon(Icons.copy, size: 18), label: const Text('Copy')),
                if (link != null) TextButton.icon(onPressed: () => onOpenLink(link), icon: const Icon(Icons.open_in_new, size: 18), label: const Text('Open')),
                if (!item.isText) TextButton.icon(onPressed: () => onDownload(item), icon: const Icon(Icons.download, size: 18), label: const Text('Save')),
                const Spacer(),
                IconButton(tooltip: 'Delete', icon: const Icon(Icons.delete_outline), onPressed: () => onDelete(item)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
