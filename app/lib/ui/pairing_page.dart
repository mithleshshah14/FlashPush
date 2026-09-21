import 'dart:async';

import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/errors.dart';
import '../net/connection.dart';
import '../net/pairing.dart';
import '../theme.dart';

/// Shows the 6-digit code to compare with the laptop while the user approves there.
/// Pops with the new [LaptopConnection] when the pairing succeeded, otherwise with null.
class PairingPage extends StatefulWidget {
  const PairingPage({super.key, required this.controller, required this.host, required this.port});

  final AppController controller;
  final String host;
  final int port;

  @override
  State<PairingPage> createState() => _PairingPageState();
}

class _PairingPageState extends State<PairingPage> {
  PairingFlow? _flow;
  StreamSubscription<PairingProgress>? _subscription;
  PairingProgress? _progress;

  @override
  void initState() {
    super.initState();
    _start();
  }

  void _start() {
    final flow = widget.controller.beginPairing(widget.host, widget.port);
    _flow = flow;
    _progress = null;
    _subscription = flow.run().listen(_onProgress);
  }

  Future<void> _onProgress(PairingProgress progress) async {
    if (!mounted) return;
    setState(() => _progress = progress);
    if (progress is PairingApproved) {
      final connection = await widget.controller.finishPairing(progress);
      if (mounted) Navigator.of(context).pop(connection);
    }
  }

  void _retry() {
    setState(_start);
  }

  @override
  void dispose() {
    _flow?.cancel();
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final progress = _progress;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(icon: const Icon(Icons.close), tooltip: 'Cancel', onPressed: () => Navigator.of(context).pop()),
        title: const Text('Pair with laptop'),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: switch (progress) {
            null => const _Message(icon: Icons.sync, title: 'Contacting the laptop...', spinner: true),
            PairingWaiting(:final sasDisplay) => _Waiting(code: sasDisplay, onCancel: () => Navigator.of(context).pop()),
            PairingApproved() => const _Message(icon: Icons.check_circle, title: 'Paired', body: 'Connecting...', spinner: true),
            PairingDenied() => _Failure(title: 'The laptop denied the request', onRetry: _retry),
            PairingExpired() => _Failure(title: 'The request expired', body: 'Start again and approve it on the laptop within two minutes.', onRetry: _retry),
            PairingFailed(:final error) => _Failure(title: 'Pairing did not work', body: userMessage(error), onRetry: _retry),
          },
        ),
      ),
    );
  }
}

class _Waiting extends StatelessWidget {
  const _Waiting({required this.code, required this.onCancel});

  final String code;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final flash = context.flash;
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Text('Check that this code matches the one on your laptop, then approve it there.', textAlign: TextAlign.center),
        const SizedBox(height: 32),
        Semantics(
          label: 'Pairing code ${code.replaceAll(' ', ', ').split('').join(' ')}',
          excludeSemantics: true,
          child: Text(
            code,
            key: const Key('pairing-code'),
            style: TextStyle(fontFamily: monoFamily, fontSize: 64, fontWeight: FontWeight.w600, letterSpacing: 4, color: flash.on),
          ),
        ),
        const SizedBox(height: 32),
        const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)),
        const SizedBox(height: 12),
        const Text('Waiting for approval on the laptop...'),
        const SizedBox(height: 32),
        OutlinedButton(onPressed: onCancel, child: const Text('Cancel')),
        const SizedBox(height: 8),
        Text('If the codes are different, deny the request on the laptop.', style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
      ],
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.title, this.body, this.spinner = false});

  final IconData icon;
  final String title;
  final String? body;
  final bool spinner;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 56, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 16),
          Text(title, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
          if (body != null) ...[const SizedBox(height: 8), Text(body!, textAlign: TextAlign.center)],
          if (spinner) ...[const SizedBox(height: 24), const CircularProgressIndicator()],
        ],
      ),
    );
  }
}

class _Failure extends StatelessWidget {
  const _Failure({required this.title, required this.onRetry, this.body});

  final String title;
  final String? body;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline, size: 56, color: Theme.of(context).colorScheme.error),
          const SizedBox(height: 16),
          Text(title, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
          if (body != null) ...[const SizedBox(height: 8), Text(body!, textAlign: TextAlign.center)],
          const SizedBox(height: 24),
          FilledButton(onPressed: onRetry, child: const Text('Try again')),
          const SizedBox(height: 8),
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Close')),
        ],
      ),
    );
  }
}
