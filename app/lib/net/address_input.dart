import '../core/models.dart';

typedef HostPort = ({String host, int port});

const defaultDevicePort = 8765;

final _hostPattern = RegExp(r'^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$');
final _ipv4Pattern = RegExp(r'^\d{1,3}(\.\d{1,3}){3}$');

/// Parses what the user types in "Add by address": an IPv4 address or a name (for example a Tailscale
/// MagicDNS name), optionally followed by `:port`. Returns null when it is not a usable address.
HostPort? parseAddress(String input) {
  var text = input.trim();
  text = text.replaceFirst(RegExp(r'^https?://', caseSensitive: false), '').replaceFirst(RegExp(r'/+$'), '');
  final parts = text.split(':');
  if (parts.length > 2) return null; // IPv6 is not supported in v1
  final host = parts.first;
  if (!_hostPattern.hasMatch(host)) return null;
  if (_ipv4Pattern.hasMatch(host) && host.split('.').any((o) => int.parse(o) > 255)) return null;
  var port = defaultDevicePort;
  if (parts.length == 2) {
    final parsed = int.tryParse(parts[1]);
    if (parsed == null || parsed < 1 || parsed > 65535) return null;
    port = parsed;
  }
  return (host: host, port: port);
}

/// The kind stored for an address the user typed.
LaptopAddress manualAddress(HostPort target) => LaptopAddress(host: target.host, port: target.port, kind: 'manual');
