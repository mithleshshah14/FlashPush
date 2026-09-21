import 'package:flutter/material.dart';

import '../net/link_state.dart';
import '../theme.dart';

/// The two connection controls shown in headers and list rows (design: DESIGN.md §6).
///
/// Wi-Fi is a status indicator; the link icon is the connect/disconnect button. Green means on,
/// grey means off, and the glyph shape also differs (solid vs slashed) so colour is never the only signal.
/// There are deliberately no status words: the route is only available as a tooltip.
class ConnectionControls extends StatelessWidget {
  const ConnectionControls({
    super.key,
    required this.state,
    required this.route,
    required this.wifiUp,
    required this.onLinkPressed,
    this.onWifiPressed,
  });

  final LinkState state;
  final RouteKind route;
  final bool wifiUp;
  final VoidCallback onLinkPressed;
  final VoidCallback? onWifiPressed;

  @override
  Widget build(BuildContext context) {
    final linked = state == LinkState.connected;
    final connecting = state == LinkState.connecting || state == LinkState.disconnecting;
    final routeNote = route == RouteKind.tailscale ? ' Reached via Tailscale.' : '';
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _ControlButton(
          key: const Key('wifi-control'),
          on: wifiUp,
          onIcon: Icons.wifi,
          offIcon: Icons.wifi_off,
          label: 'Wi-Fi: ${wifiUp ? 'on' : 'off'}',
          tooltip: 'Wi-Fi: ${wifiUp ? 'on' : 'off'}.$routeNote'.trim(),
          onPressed: onWifiPressed,
        ),
        const SizedBox(width: 8),
        _ControlButton(
          key: const Key('link-control'),
          on: linked,
          busy: connecting,
          onIcon: Icons.link,
          offIcon: Icons.link_off,
          label: 'Linked to laptop: ${linked ? 'on. Tap to disconnect' : connecting ? 'connecting' : 'off. Tap to connect'}',
          tooltip: 'Linked to laptop: ${linked ? 'on' : 'off'}.$routeNote'.trim(),
          onPressed: onLinkPressed,
        ),
      ],
    );
  }
}

class _ControlButton extends StatelessWidget {
  const _ControlButton({
    super.key,
    required this.on,
    required this.onIcon,
    required this.offIcon,
    required this.label,
    required this.tooltip,
    required this.onPressed,
    this.busy = false,
  });

  final bool on;
  final bool busy;
  final IconData onIcon;
  final IconData offIcon;
  final String label;
  final String tooltip;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = context.flash;
    final color = on ? colors.on : colors.off;
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      onTap: onPressed,
      child: Tooltip(
        message: tooltip,
        child: Material(
          color: on ? colors.on.withValues(alpha: 0.16) : Colors.transparent,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: on ? colors.on.withValues(alpha: 0.6) : colors.off.withValues(alpha: 0.6))),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onPressed,
            child: SizedBox(
              width: 48,
              height: 48,
              child: Center(
                child: busy
                    ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: colors.cyan))
                    : Icon(on ? onIcon : offIcon, color: color, size: 24),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
