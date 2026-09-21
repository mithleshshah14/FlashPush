import 'dart:typed_data';

/// One history entry as the laptop sends it (docs/protocol.md, GET /v1/items).
class Item {
  const Item({
    required this.id,
    required this.kind,
    required this.from,
    required this.time,
    this.text,
    this.name,
    this.size,
    this.mime,
  });

  final String id;
  final String kind; // 'text' | 'file'
  final String from; // 'phone' | 'laptop'
  final DateTime time;
  final String? text;
  final String? name;
  final int? size;
  final String? mime;

  bool get isText => kind == 'text';
  bool get isImage => !isText && (mime ?? '').startsWith('image/');
  bool get isFile => !isText && !isImage;
  bool get fromLaptop => from == 'laptop';

  factory Item.fromJson(Map<String, dynamic> json) => Item(
        id: json['id'] as String,
        kind: json['kind'] as String,
        from: json['from'] as String,
        time: DateTime.fromMillisecondsSinceEpoch((json['time'] as num).toInt()),
        text: json['text'] as String?,
        name: json['name'] as String?,
        size: (json['size'] as num?)?.toInt(),
        mime: json['mime'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind,
        'from': from,
        'time': time.millisecondsSinceEpoch,
        if (text != null) 'text': text,
        if (name != null) 'name': name,
        if (size != null) 'size': size,
        if (mime != null) 'mime': mime,
      };
}

/// An address a laptop can be reached at. [kind] is lan, tailscale, other or manual.
class LaptopAddress {
  const LaptopAddress({required this.host, required this.port, required this.kind});

  final String host;
  final int port;
  final String kind;

  bool get isTailscale => kind == 'tailscale' || (kind == 'manual' && isTailscaleHost(host));

  factory LaptopAddress.fromJson(Map<String, dynamic> json) =>
      LaptopAddress(host: json['host'] as String, port: json['port'] as int, kind: json['kind'] as String);

  Map<String, dynamic> toJson() => {'host': host, 'port': port, 'kind': kind};

  @override
  bool operator ==(Object other) => other is LaptopAddress && other.host == host && other.port == port;

  @override
  int get hashCode => Object.hash(host, port);
}

/// A saved (paired or being paired) laptop. Secrets live in [Credentials], never here.
class Laptop {
  const Laptop({required this.id, required this.name, required this.addresses, this.lastHost});

  final String id;
  final String name;
  final List<LaptopAddress> addresses;
  final String? lastHost; // the address that last passed certificate verification

  Laptop copyWith({String? name, List<LaptopAddress>? addresses, String? lastHost}) => Laptop(
        id: id,
        name: name ?? this.name,
        addresses: addresses ?? this.addresses,
        lastHost: lastHost ?? this.lastHost,
      );

  factory Laptop.fromJson(Map<String, dynamic> json) => Laptop(
        id: json['id'] as String,
        name: json['name'] as String,
        addresses: [for (final a in json['addresses'] as List<dynamic>) LaptopAddress.fromJson(a as Map<String, dynamic>)],
        lastHost: json['lastHost'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'addresses': [for (final a in addresses) a.toJson()],
        if (lastHost != null) 'lastHost': lastHost,
      };
}

/// What the phone must keep secret about a pairing.
class Credentials {
  const Credentials({required this.secret, required this.fingerprint});

  final String secret; // base64url device secret
  final Uint8List fingerprint; // SHA-256 of the pinned certificate
}

/// A laptop that answered a discovery broadcast (a hint, not yet trusted).
class DiscoveredLaptop {
  const DiscoveredLaptop({required this.laptopId, required this.name, required this.host, required this.port});

  final String laptopId;
  final String name;
  final String host;
  final int port;
}

/// Tailscale addresses: 100.64.0.0/10 or a MagicDNS name (*.ts.net).
bool isTailscaleHost(String host) {
  if (host.toLowerCase().endsWith('.ts.net')) return true;
  final parts = host.split('.');
  if (parts.length != 4) return false;
  final octets = parts.map(int.tryParse).toList();
  return octets[0] == 100 && octets[1] != null && octets[1]! >= 64 && octets[1]! <= 127;
}
