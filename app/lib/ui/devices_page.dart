import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/models.dart';
import '../net/address_input.dart';
import '../net/connection.dart';
import '../net/link_state.dart';
import '../theme.dart';
import 'add_address_sheet.dart';
import 'connection_controls.dart';

/// The Devices tab: laptops seen on the network and saved ones, each with the two connection controls.
class DevicesPage extends StatelessWidget {
  const DevicesPage({super.key, required this.controller, required this.onOpenLaptop, required this.onPair});

  final AppController controller;
  final void Function(LaptopConnection connection) onOpenLaptop;
  final void Function(String host, int port) onPair;

  Future<void> _addByAddress(BuildContext context) async {
    final target = await showAddAddressSheet(context);
    if (target != null) onPair(target.host, target.port);
  }

  void _toggle(LaptopRow row) {
    final connection = row.connection;
    if (connection == null) {
      final host = row.host;
      final port = row.discovered?.port ?? defaultDevicePort;
      if (host != null) onPair(host, port);
    } else if (row.state == LinkState.connected || row.state == LinkState.connecting) {
      controller.disconnect(row.id);
    } else {
      controller.connect(row.id);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final rows = controller.rows;
        return Scaffold(
          appBar: AppBar(
            title: const Text('Laptops'),
            actions: [
              IconButton(icon: const Icon(Icons.refresh), tooltip: 'Scan again', onPressed: controller.discovery.scanNow),
            ],
          ),
          body: RefreshIndicator(
            onRefresh: controller.discovery.scanNow,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              children: [
                if (rows.isEmpty) _EmptyState(scanning: controller.discovery.scanning) else const _PullHint(),
                for (final row in rows) ...[
                  _LaptopCard(
                    row: row,
                    onTap: row.connection == null ? () => _toggle(row) : () => onOpenLaptop(row.connection!),
                    onLink: () => _toggle(row),
                  ),
                  const SizedBox(height: 12),
                ],
                const SizedBox(height: 12),
                Center(
                  child: TextButton(
                    key: const Key('add-by-address'),
                    onPressed: () => _addByAddress(context),
                    child: const Text("Can't find your laptop? Add by address"),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _PullHint extends StatelessWidget {
  const _PullHint();

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Center(child: Text('Pull down to scan again', style: Theme.of(context).textTheme.bodySmall)),
      );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.scanning});

  final bool scanning;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Column(
        children: [
          Icon(Icons.laptop_mac, size: 64, color: context.flash.cyan),
          const SizedBox(height: 16),
          Text(scanning ? 'Looking for your laptop...' : 'No laptop found yet', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          const Text('Make sure FlashPush is running on your laptop and both are on the same Wi-Fi.', textAlign: TextAlign.center),
          if (scanning) ...[const SizedBox(height: 16), const CircularProgressIndicator()],
        ],
      ),
    );
  }
}

class _LaptopCard extends StatelessWidget {
  const _LaptopCard({required this.row, required this.onTap, required this.onLink});

  final LaptopRow row;
  final VoidCallback onTap;
  final VoidCallback onLink;

  bool get _tailscale => row.route == RouteKind.tailscale || (row.route == RouteKind.none && row.host != null && isTailscaleHost(row.host!));

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      key: Key('laptop-${row.id}'),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.laptop_mac, color: context.flash.cyan),
                  const SizedBox(width: 12),
                  Expanded(child: Text(row.name, style: theme.textTheme.titleMedium, overflow: TextOverflow.ellipsis)),
                  _RouteChip(tailscale: _tailscale),
                ],
              ),
              if (row.host != null) ...[
                const SizedBox(height: 4),
                Padding(
                  padding: const EdgeInsets.only(left: 36),
                  child: Text(row.host!, style: theme.textTheme.bodyMedium?.copyWith(fontFamily: monoFamily, color: theme.colorScheme.onSurfaceVariant)),
                ),
              ],
              const Divider(height: 24),
              Row(
                children: [
                  _PairingWord(state: row.state),
                  const Spacer(),
                  ConnectionControls(state: row.state, route: row.route, wifiUp: row.wifiUp, onLinkPressed: onLink),
                ],
              ),
              if (!row.paired) ...[
                const SizedBox(height: 8),
                Row(children: [
                  Icon(Icons.info_outline, size: 16, color: theme.colorScheme.onSurfaceVariant),
                  const SizedBox(width: 8),
                  Expanded(child: Text('Needs approval on the laptop', style: theme.textTheme.bodySmall)),
                ]),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _RouteChip extends StatelessWidget {
  const _RouteChip({required this.tailscale});

  final bool tailscale;

  @override
  Widget build(BuildContext context) {
    final color = tailscale ? context.flash.tailscale : context.flash.cyan;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), border: Border.all(color: color), color: tailscale ? null : color.withValues(alpha: 0.12)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(tailscale ? Icons.hub_outlined : Icons.wifi, size: 14, color: color),
        const SizedBox(width: 4),
        Text(tailscale ? 'Tailscale' : 'Wi-Fi', style: TextStyle(fontSize: 12, color: color)),
      ]),
    );
  }
}

/// A word only where the laptop needs the user to act (not paired, identity changed). A paired laptop shows
/// nothing here: pairing is not a status to read, and connection state is shown by the icons only.
class _PairingWord extends StatelessWidget {
  const _PairingWord({required this.state});

  final LinkState state;

  @override
  Widget build(BuildContext context) {
    final (String text, Color color)? shown = switch (state) {
      LinkState.notPaired || LinkState.unpaired => ('Not paired', context.flash.off),
      LinkState.certChanged => ('Identity changed', context.flash.warning),
      _ => null,
    };
    if (shown == null) return const SizedBox.shrink();
    final (text, color) = shown;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(Icons.circle, size: 10, color: color),
      const SizedBox(width: 8),
      Text(text),
    ]);
  }
}
