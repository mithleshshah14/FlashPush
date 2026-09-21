import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'api.dart';

class PairingPage extends StatefulWidget {
  const PairingPage({super.key, required this.onPaired});

  final Future<void> Function(Connection) onPaired;

  @override
  State<PairingPage> createState() => _PairingPageState();
}

class _PairingPageState extends State<PairingPage> {
  final _link = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _link.dispose();
    super.dispose();
  }

  Future<void> _connect(String input) async {
    final connection = Connection.parse(input);
    if (connection == null) {
      setState(() => _error = 'That does not look like a FlashPush link. It should end with ?t=...');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = FlashPushApi(connection);
    final problem = await api.check();
    api.close();
    if (!mounted) return;
    if (problem != null) {
      setState(() {
        _busy = false;
        _error = problem;
      });
      return;
    }
    await widget.onPaired(connection);
  }

  Future<void> _scan() async {
    final value = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const _ScanPage()));
    if (value != null && mounted) {
      _link.text = value;
      await _connect(value);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const SizedBox(height: 24),
            Icon(Icons.bolt_rounded, size: 56, color: theme.colorScheme.primary),
            const SizedBox(height: 12),
            Text('FlashPush', style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(
              'Start the server on your laptop, then scan the QR code it shows. Both devices must be on the same Wi-Fi.',
              style: theme.textTheme.bodyLarge,
            ),
            const SizedBox(height: 28),
            FilledButton.icon(
              onPressed: _busy ? null : _scan,
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text('Scan QR code'),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
            ),
            const SizedBox(height: 28),
            Text('Or paste the link', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            TextField(
              controller: _link,
              enabled: !_busy,
              keyboardType: TextInputType.url,
              autocorrect: false,
              decoration: const InputDecoration(
                hintText: 'http://192.168.1.6:8765/?t=...',
                border: OutlineInputBorder(),
              ),
              onSubmitted: _connect,
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: _busy ? null : () => _connect(_link.text),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              child: _busy
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Connect'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
            ],
          ],
        ),
      ),
    );
  }
}

class _ScanPage extends StatefulWidget {
  const _ScanPage();

  @override
  State<_ScanPage> createState() => _ScanPageState();
}

class _ScanPageState extends State<_ScanPage> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan the QR code on your laptop')),
      body: MobileScanner(
        onDetect: (capture) {
          if (_done) return;
          final value = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
          if (value == null) return;
          _done = true;
          Navigator.of(context).pop(value);
        },
        errorBuilder: (context, error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('Camera unavailable (${error.errorCode.name}). Allow camera access, or paste the link instead.'),
          ),
        ),
      ),
    );
  }
}
