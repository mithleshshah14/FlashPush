import 'package:flutter/material.dart';

import '../net/address_input.dart';

/// "Add by address": for laptops that discovery cannot find (client-isolated Wi-Fi) and for Tailscale.
Future<HostPort?> showAddAddressSheet(BuildContext context) {
  return showModalBottomSheet<HostPort>(
    context: context,
    isScrollControlled: true,
    builder: (_) => const _AddAddressSheet(),
  );
}

class _AddAddressSheet extends StatefulWidget {
  const _AddAddressSheet();

  @override
  State<_AddAddressSheet> createState() => _AddAddressSheetState();
}

class _AddAddressSheetState extends State<_AddAddressSheet> {
  final _field = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _field.dispose();
    super.dispose();
  }

  void _submit() {
    final target = parseAddress(_field.text);
    if (target == null) {
      setState(() => _error = 'Enter an IP address or a name, like 192.168.1.6 or laptop.tail1234.ts.net.');
      return;
    }
    Navigator.of(context).pop(target);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 24, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Add laptop by address', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          const Text('Use this when your laptop is not found automatically, or to reach it over Tailscale.'),
          const SizedBox(height: 16),
          TextField(
            key: const Key('address-field'),
            controller: _field,
            autofocus: true,
            keyboardType: TextInputType.url,
            autocorrect: false,
            textInputAction: TextInputAction.go,
            onSubmitted: (_) => _submit(),
            decoration: InputDecoration(
              labelText: 'Address',
              hintText: '192.168.1.6 or laptop.tail1234.ts.net',
              helperText: 'Port is optional (default 8765)',
              errorText: _error,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
              const SizedBox(width: 8),
              FilledButton(onPressed: _submit, child: const Text('Connect')),
            ],
          ),
        ],
      ),
    );
  }
}
