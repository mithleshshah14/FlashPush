import 'package:flutter/material.dart';

import '../net/link_state.dart';
import '../theme.dart';

/// Replaces the laptop detail content when the laptop can no longer be trusted or used
/// (docs/connection-state.md: the retry loop has stopped and the user must decide).
class ProblemView extends StatelessWidget {
  const ProblemView({super.key, required this.state, required this.onRePair, required this.onForget});

  final LinkState state; // LinkState.unpaired or LinkState.certChanged
  final VoidCallback onRePair;
  final VoidCallback onForget;

  bool get _identityChanged => state == LinkState.certChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = _identityChanged ? context.flash.warning : theme.colorScheme.error;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(_identityChanged ? Icons.gpp_maybe_outlined : Icons.link_off, size: 64, color: color),
            const SizedBox(height: 16),
            Text(_identityChanged ? 'Laptop identity changed' : 'Not paired anymore', style: theme.textTheme.titleLarge, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(
              _identityChanged
                  ? 'This laptop showed a different certificate than the one you approved, so nothing was sent. Only pair again if you reset FlashPush on the laptop yourself.'
                  : 'This laptop no longer knows this phone. It may have been removed on the laptop.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            FilledButton(
              key: const Key('problem-primary'),
              onPressed: onRePair,
              child: Text(_identityChanged ? 'Forget and pair again' : 'Re-pair'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(key: const Key('problem-forget'), onPressed: onForget, child: const Text('Forget')),
          ],
        ),
      ),
    );
  }
}
