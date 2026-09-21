import 'package:flashpush/core/models.dart';
import 'package:flashpush/net/address_input.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses IPv4, names, and an optional port, with the default 8765', () {
    expect(parseAddress('192.168.1.6'), (host: '192.168.1.6', port: 8765));
    expect(parseAddress(' 192.168.1.6:9000 '), (host: '192.168.1.6', port: 9000));
    expect(parseAddress('my-laptop.tail1234.ts.net'), (host: 'my-laptop.tail1234.ts.net', port: 8765));
    expect(parseAddress('https://MITHLESH-PC:8765/'), (host: 'MITHLESH-PC', port: 8765));
  });

  test('rejects empty, malformed, IPv6, bad octets and bad ports', () {
    for (final bad in ['', '  ', 'a b', '-host', 'host-', '300.1.1.1', '1.2.3.4:0', '1.2.3.4:70000', '1.2.3.4:abc', '::1', 'a:1:2', 'ho\$t', '.host']) {
      expect(parseAddress(bad), isNull, reason: '"$bad"');
    }
  });

  test('Tailscale addresses are recognised: 100.64.0.0/10 and .ts.net names', () {
    for (final host in ['100.64.0.1', '100.101.102.103', '100.127.255.255', 'laptop.tail1.ts.net', 'X.TS.NET']) {
      expect(isTailscaleHost(host), isTrue, reason: host);
    }
    for (final host in ['100.63.0.1', '100.128.0.1', '192.168.1.6', 'laptop.local', '10.0.0.1']) {
      expect(isTailscaleHost(host), isFalse, reason: host);
    }
  });

  test('a typed address counts as Tailscale when it looks like one', () {
    expect(manualAddress((host: '100.101.102.103', port: 8765)).isTailscale, isTrue);
    expect(manualAddress((host: '192.168.1.9', port: 8765)).isTailscale, isFalse);
  });
}
