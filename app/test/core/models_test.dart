import 'package:flashpush/core/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('a text item round-trips through JSON', () {
    final item = Item.fromJson({'id': 'a', 'kind': 'text', 'from': 'laptop', 'time': 1000, 'text': 'hi'});
    expect(item.isText, isTrue);
    expect(item.fromLaptop, isTrue);
    expect(item.time, DateTime.fromMillisecondsSinceEpoch(1000));
    expect(Item.fromJson(item.toJson()).text, 'hi');
    expect(item.toJson().containsKey('name'), isFalse);
  });

  test('files are split into images and other files by mime type', () {
    Item file(String mime) => Item(id: 'i', kind: 'file', from: 'phone', time: DateTime(2026), name: 'x', size: 1, mime: mime);
    expect(file('image/png').isImage, isTrue);
    expect(file('image/png').isFile, isFalse);
    expect(file('application/pdf').isFile, isTrue);
    expect(file('application/pdf').isImage, isFalse);
  });

  test('a laptop round-trips through JSON and copyWith keeps the id', () {
    const laptop = Laptop(
      id: 'l1',
      name: 'MITHLESH-PC',
      addresses: [
        LaptopAddress(host: '192.168.1.6', port: 8765, kind: 'lan'),
        LaptopAddress(host: '100.101.102.103', port: 8765, kind: 'tailscale'),
      ],
      lastHost: '192.168.1.6',
    );
    final copy = Laptop.fromJson(laptop.toJson());
    expect(copy.addresses.length, 2);
    expect(copy.addresses[1].isTailscale, isTrue);
    expect(copy.lastHost, '192.168.1.6');
    expect(laptop.copyWith(name: 'Renamed').id, 'l1');
  });

  test('addresses compare by host and port', () {
    expect(const LaptopAddress(host: 'a', port: 1, kind: 'lan'), const LaptopAddress(host: 'a', port: 1, kind: 'manual'));
    expect(const LaptopAddress(host: 'a', port: 1, kind: 'lan') == const LaptopAddress(host: 'a', port: 2, kind: 'lan'), isFalse);
  });
}
