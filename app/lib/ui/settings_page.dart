import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../theme.dart';
import '../version.dart';
import 'platform_actions.dart';

const documentationUrl = 'https://github.com/mithleshshah14/FlashPush/tree/main/docs';

/// Settings: this phone's name, paired laptops, appearance, connection and about.
class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key, required this.controller, required this.actions, required this.onRePair});

  final AppController controller;
  final PlatformActions actions;
  final void Function(String host, int port) onRePair;

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  late final TextEditingController _name = TextEditingController(text: widget.controller.settings.phoneName);

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _saveName() async {
    await widget.controller.setPhoneName(_name.text);
    _name.text = widget.controller.settings.phoneName;
    if (mounted) {
      FocusScope.of(context).unfocus();
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('Phone name saved')));
    }
  }

  Future<void> _confirmForget(LaptopRow row) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Forget ${row.name}?'),
        content: const Text('This phone will need to be approved on the laptop again, and the saved history for this laptop is removed.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Forget')),
        ],
      ),
    );
    if (confirmed == true) await widget.controller.forget(row.id);
  }

  void _rePair(LaptopRow row) {
    final address = widget.controller.addressOf(row.id);
    if (address != null) widget.onRePair(address.host, address.port);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final controller = widget.controller;
        final paired = controller.rows.where((r) => r.paired).toList();
        return Scaffold(
          appBar: AppBar(title: const Text('Settings')),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const _Section('This phone'),
              TextField(
                key: const Key('phone-name'),
                controller: _name,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _saveName(),
                decoration: InputDecoration(
                  labelText: 'Phone name',
                  helperText: 'Shown to the laptop when you pair',
                  suffixIcon: IconButton(key: const Key('save-name'), icon: const Icon(Icons.check), tooltip: 'Save name', onPressed: _saveName),
                ),
              ),
              const _Section('Paired laptops'),
              if (paired.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('No laptops paired yet.')),
              for (final row in paired)
                Card(
                  key: Key('paired-${row.id}'),
                  child: ListTile(
                    leading: Icon(Icons.laptop_mac, color: context.flash.cyan),
                    title: Text(row.name),
                    subtitle: row.host == null ? null : Text(row.host!, style: TextStyle(fontFamily: monoFamily, color: theme.colorScheme.onSurfaceVariant)),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      TextButton(onPressed: () => _rePair(row), child: const Text('Re-pair')),
                      TextButton(onPressed: () => _confirmForget(row), child: Text('Forget', style: TextStyle(color: theme.colorScheme.error))),
                    ]),
                  ),
                ),
              const _Section('Appearance'),
              SegmentedButton<ThemeMode>(
                key: const Key('theme-mode'),
                segments: const [
                  ButtonSegment(value: ThemeMode.system, label: Text('System')),
                  ButtonSegment(value: ThemeMode.dark, label: Text('Dark')),
                  ButtonSegment(value: ThemeMode.light, label: Text('Light')),
                ],
                selected: {controller.themeMode},
                onSelectionChanged: (selection) => controller.setThemeMode(selection.first),
              ),
              const _Section('Connection'),
              SwitchListTile(
                key: const Key('auto-reconnect'),
                contentPadding: EdgeInsets.zero,
                title: const Text('Reconnect automatically'),
                subtitle: const Text('Keep trying when the laptop goes out of reach'),
                value: controller.settings.autoReconnect,
                onChanged: controller.setAutoReconnect,
              ),
              ListTile(
                key: const Key('scan-again'),
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.refresh),
                title: const Text('Scan again for laptops'),
                onTap: controller.discovery.scanNow,
              ),
              const _Section('About'),
              const ListTile(contentPadding: EdgeInsets.zero, title: Text('FlashPush'), subtitle: Text('Version $appVersion')),
              ListTile(
                key: const Key('documentation'),
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.menu_book_outlined),
                title: const Text('Documentation'),
                onTap: () => widget.actions.openLink(documentationUrl),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 24, bottom: 8),
        child: Text(title.toUpperCase(), style: Theme.of(context).textTheme.labelMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
      );
}
