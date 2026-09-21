import 'package:flutter/material.dart';

import '../theme.dart';

/// The empty state of a list tab: a line icon and one line of text.
class EmptyTab extends StatelessWidget {
  const EmptyTab({super.key, required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 48, color: context.flash.cyan),
          const SizedBox(height: 12),
          Text(text),
        ]),
      );
}
