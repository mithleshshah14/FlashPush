import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/models.dart';
import '../theme.dart';
import 'empty_tab.dart';
import 'format.dart';

final _link = RegExp(r'https?://[^\s]+');

/// Text and links, both directions, oldest first, with day separators.
class MessageList extends StatelessWidget {
  const MessageList({super.key, required this.items, required this.onOpenLink});

  final List<Item> items;
  final void Function(String url) onOpenLink;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const EmptyTab(icon: Icons.chat_bubble_outline, text: 'No messages yet');
    final children = <Widget>[];
    String? lastDay;
    for (final item in items) {
      final day = dayLabel(item.time);
      if (day != lastDay) {
        children.add(_DayChip(label: day));
        lastDay = day;
      }
      children.add(_Bubble(item: item, onOpenLink: onOpenLink));
    }
    return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: children);
  }
}

class _DayChip extends StatelessWidget {
  const _DayChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), border: Border.all(color: context.flash.hairline)),
            child: Text(label.toUpperCase(), style: Theme.of(context).textTheme.labelSmall),
          ),
        ),
      );
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.item, required this.onOpenLink});

  final Item item;
  final void Function(String url) onOpenLink;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final text = item.text ?? '';
    final url = _link.firstMatch(text)?.group(0);
    final mine = !item.fromLaptop;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.82),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!mine) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('From laptop', style: theme.textTheme.labelSmall)),
            Card(
              color: mine ? theme.colorScheme.surfaceContainerHighest : theme.colorScheme.surface,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SelectableText(text, style: url == null ? null : TextStyle(color: context.flash.cyan, fontFamily: monoFamily)),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        if (url != null) TextButton.icon(onPressed: () => onOpenLink(url), icon: const Icon(Icons.open_in_new, size: 16), label: const Text('Open')),
                        TextButton.icon(
                          onPressed: () async {
                            await Clipboard.setData(ClipboardData(text: text));
                            if (context.mounted) {
                              ScaffoldMessenger.of(context)
                                ..hideCurrentSnackBar()
                                ..showSnackBar(const SnackBar(content: Text('Copied')));
                            }
                          },
                          icon: const Icon(Icons.copy, size: 16),
                          label: const Text('Copy'),
                        ),
                        const Spacer(),
                        Text(clockTime(item.time), style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
