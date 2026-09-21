// Talks to the REAL laptop server over real TLS. Skipped when Node.js is not installed.
import 'dart:io';
import 'dart:typed_data';

import 'package:flashpush/core/errors.dart';
import 'package:flashpush/core/http_laptop_api.dart';
import 'package:flashpush/core/models.dart';
import 'package:flashpush/core/protocol_crypto.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/real_server.dart';

Future<void> expectApiError(Future<Object?> future, String code) =>
    expectLater(future, throwsA(isA<ApiException>().having((e) => e.code, 'code', code)));

void main() {
  RealServer? server;
  late Directory tmp;

  setUpAll(() async {
    server = await RealServer.start();
    tmp = await Directory.systemTemp.createTemp('flashpush-it-client-');
  });

  tearDownAll(() async {
    await server?.stop();
    await tmp.delete(recursive: true);
  });

  test('pair with matching codes, connect, exchange data, get live events, and be revoked', () async {
    final srv = server;
    if (srv == null) {
      markTestSkipped('Node.js is not installed');
      return;
    }

    // First contact: the certificate is only recorded.
    final first = HttpLaptopApi('127.0.0.1', srv.devicePort);
    addTearDown(first.close);
    final hello = await first.hello();
    expect(hello.name, isNotEmpty);
    final fingerprint = first.seenFingerprint!;
    expect(fingerprint.length, 32);

    // Pairing exactly as docs/pairing.md.
    final deviceId = newUuid();
    final np = randomBytes(16);
    final request = await first.pairRequest(deviceId: deviceId, deviceName: 'Test phone', commit: commitOf(np));
    await first.pairReveal(requestId: request.requestId, np: np);
    final proof = pairProof(np, b64uDecode(request.requestId, 16), deviceId);
    expect((await first.pairStatus(requestId: request.requestId, deviceId: deviceId, proof: proof)).approved, isFalse);

    final pending = ((await srv.admin('GET', '/admin/state'))['pending'] as List<dynamic>).single as Map<String, dynamic>;
    expect(pending['sas'], sasCode(fingerprint, np, request.nl), reason: 'both screens must show the same code');
    await srv.admin('POST', '/admin/pair/${pending['requestId']}/approve');

    final approved = await first.pairStatus(requestId: request.requestId, deviceId: deviceId, proof: proof);
    expect(approved.approved, isTrue);
    expect(approved.addresses, isNotEmpty);
    final secret = approved.secret!;

    // Connect on a pinned connection.
    final api = HttpLaptopApi('127.0.0.1', srv.devicePort, pin: fingerprint);
    addTearDown(api.close);
    final session = await api.connect(deviceId: deviceId, secret: secret);
    final token = session.token;
    expect(await api.items(token), isEmpty);

    // Phone to laptop: text and a file, retry-safe with an operation id.
    final opId = newUuid();
    final text = await api.sendText(token, 'hello laptop', opId);
    expect((await api.sendText(token, 'hello laptop', opId)).id, text.id, reason: 'same operation id gives the same item');
    final source = File('${tmp.path}${Platform.pathSeparator}note.txt')..writeAsStringSync('file body');
    var lastProgress = 0;
    final file = await api.sendFile(token, source, 'note.txt', newUuid(), onProgress: (done, total) => lastProgress = done);
    expect(lastProgress, 9);
    expect(file.name, 'note.txt');
    expect(File('${srv.receiveDir.path}${Platform.pathSeparator}note.txt').readAsStringSync(), 'file body');
    expect((await api.items(token)).length, 2);

    // Laptop to phone arrives on the live event stream, and the file downloads intact.
    final events = api.events(token);
    final next = events.first.timeout(const Duration(seconds: 5));
    await srv.admin('POST', '/admin/text', body: {'text': 'hello phone'});
    final event = await next;
    expect(event.event, 'item-added');
    expect(Item.fromJson(event.data).text, 'hello phone');
    final downloaded = await api.download(token, file, tmp);
    expect(downloaded.readAsStringSync(), 'file body');

    // A wrong pin is refused before anything is sent.
    final wrongPin = HttpLaptopApi('127.0.0.1', srv.devicePort, pin: Uint8List(32));
    addTearDown(wrongPin.close);
    await expectLater(wrongPin.connect(deviceId: deviceId, secret: secret), throwsA(isA<CertificateChanged>()));

    // A pin is required to send the secret at all.
    await expectLater(first.connect(deviceId: deviceId, secret: secret), throwsStateError);

    // Disconnect, reconnect, then the laptop revokes the phone.
    await api.disconnect(token);
    await expectApiError(api.items(token), 'SESSION_EXPIRED');
    await api.connect(deviceId: deviceId, secret: secret);
    await srv.admin('DELETE', '/admin/devices/$deviceId');
    await expectApiError(api.connect(deviceId: deviceId, secret: secret), 'DEVICE_NOT_PAIRED');
  }, timeout: const Timeout(Duration(seconds: 60)));

  test('an unreachable laptop is Unreachable, not a crash', () async {
    final api = HttpLaptopApi('127.0.0.1', 1);
    addTearDown(api.close);
    await expectLater(api.hello(), throwsA(isA<Unreachable>()));
  });
}
