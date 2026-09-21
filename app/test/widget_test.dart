import 'package:flashpush/api.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Connection.parse', () {
    test('parses the QR / laptop link', () {
      final c = Connection.parse('http://192.168.1.6:8765/?t=abc123')!;
      expect(c.baseUrl, 'http://192.168.1.6:8765');
      expect(c.token, 'abc123');
    });

    test('adds http:// when missing and trims whitespace', () {
      final c = Connection.parse('  192.168.1.6:9000/?t=xyz \n')!;
      expect(c.baseUrl, 'http://192.168.1.6:9000');
      expect(c.token, 'xyz');
    });

    test('rejects links without a token or host', () {
      expect(Connection.parse('http://192.168.1.6:8765/'), isNull);
      expect(Connection.parse(''), isNull);
      expect(Connection.parse('?t=abc'), isNull);
    });
  });
}
