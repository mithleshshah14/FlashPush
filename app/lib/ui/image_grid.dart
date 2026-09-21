import 'dart:io';

import 'package:flutter/material.dart';

import '../core/errors.dart';
import '../core/models.dart';
import '../net/connection.dart';
import '../net/downloads.dart';
import 'empty_tab.dart';

/// Images sent or received, as a grid of thumbnails; tapping one opens it full screen.
class ImageGrid extends StatelessWidget {
  const ImageGrid({super.key, required this.connection, required this.items, required this.saver});

  final LaptopConnection connection;
  final List<Item> items;
  final Saver saver;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const EmptyTab(icon: Icons.image_outlined, text: 'No images yet');
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 96),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, mainAxisSpacing: 4, crossAxisSpacing: 4),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        return _Thumb(
          key: ValueKey(item.id),
          connection: connection,
          item: item,
          onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ImageViewer(connection: connection, item: item, saver: saver))),
        );
      },
    );
  }
}

class _Thumb extends StatefulWidget {
  const _Thumb({super.key, required this.connection, required this.item, required this.onTap});

  final LaptopConnection connection;
  final Item item;
  final VoidCallback onTap;

  @override
  State<_Thumb> createState() => _ThumbState();
}

class _ThumbState extends State<_Thumb> {
  late final Future<File?> _file = widget.connection.imageFile(widget.item);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Widget placeholder(bool failed) => Icon(failed ? Icons.broken_image_outlined : Icons.image_outlined, color: scheme.onSurfaceVariant);
    return Semantics(
      button: true,
      label: '${widget.item.name ?? 'Image'}, ${widget.item.fromLaptop ? 'received' : 'sent'}',
      child: InkWell(
        onTap: widget.onTap,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Stack(
            fit: StackFit.expand,
            children: [
              ColoredBox(color: scheme.surfaceContainerHighest),
              FutureBuilder<File?>(
                future: _file,
                builder: (context, snapshot) {
                  final file = snapshot.data;
                  if (file == null) return placeholder(snapshot.connectionState == ConnectionState.done);
                  return Image.file(file, fit: BoxFit.cover, cacheWidth: 300, errorBuilder: (context, error, stack) => placeholder(true));
                },
              ),
              Positioned(
                left: 4,
                bottom: 4,
                child: Container(
                  padding: const EdgeInsets.all(2),
                  decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(8)),
                  child: Icon(widget.item.fromLaptop ? Icons.south_west : Icons.north_east, size: 14, color: Colors.white),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One image, full screen, with Save.
class ImageViewer extends StatelessWidget {
  const ImageViewer({super.key, required this.connection, required this.item, required this.saver});

  final LaptopConnection connection;
  final Item item;
  final Saver saver;

  Future<void> _save(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final where = await saveItem(connection, item, saver: saver);
      messenger.showSnackBar(SnackBar(content: Text('Saved to $where')));
    } on Object catch (error) {
      messenger.showSnackBar(SnackBar(content: Text(userMessage(error))));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(item.name ?? 'Image', overflow: TextOverflow.ellipsis),
        actions: [IconButton(icon: const Icon(Icons.download), tooltip: 'Save to Downloads', onPressed: () => _save(context))],
      ),
      body: FutureBuilder<File?>(
        future: connection.imageFile(item),
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          final file = snapshot.data;
          if (file == null) return const Center(child: Text('Connect to the laptop to load this image.', style: TextStyle(color: Colors.white)));
          return InteractiveViewer(child: Center(child: Image.file(file)));
        },
      ),
    );
  }
}
