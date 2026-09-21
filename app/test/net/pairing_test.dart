import 'package:flashpush/core/errors.dart';
import 'package:flashpush/core/laptop_api.dart';
import 'package:flashpush/core/protocol_crypto.dart';
import 'package:flashpush/net/pairing.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_pairing_api.dart';

PairingFlow flow(FakePairingApi api, {Future<void> Function(Duration)? wait, List<Duration>? waits}) => PairingFlow(
      api: api,
      deviceId: '11111111-2222-3333-4444-555555555555',
      deviceName: 'Pixel 7',
      wait: (d) async {
        waits?.add(d);
        await wait?.call(d);
      },
    );

void main() {
  test('happy path: the code matches the laptop, polling every 1.5 s, then approved with the pinned fingerprint', () async {
    final api = FakePairingApi()..statusScript.addAll([const PairStatus.pending(), const PairStatus.pending(), approved()]);
    final waits = <Duration>[];
    final events = await flow(api, waits: waits).run().toList();

    expect(events.first, isA<PairingWaiting>());
    expect((events.first as PairingWaiting).sasDisplay, formatSas(api.laptopSas!), reason: 'both screens must show the same code');
    final done = events.last as PairingApproved;
    expect(done.credentials.secret, 'device-secret');
    expect(done.credentials.fingerprint, api.fingerprint);
    expect(done.laptop.id, 'laptop-1');
    expect(waits, [const Duration(milliseconds: 1500), const Duration(milliseconds: 1500)]);
  });

  test('the address the user typed is kept next to the laptop\'s own addresses', () async {
    final api = FakePairingApi()..statusScript.add(approved());
    final done = (await flow(api).run().toList()).last as PairingApproved;
    expect(done.laptop.addresses.map((a) => a.host), ['192.168.1.6', 'my-laptop.tail.ts.net']);
    expect(done.laptop.addresses.last.kind, 'manual');
    expect(done.laptop.addresses.last.isTailscale, isTrue);
    expect(done.laptop.lastHost, 'my-laptop.tail.ts.net');
  });

  test('a denied request ends as denied', () async {
    final api = FakePairingApi()..statusScript.add(ApiException('PAIR_DENIED', 403, 'denied'));
    expect((await flow(api).run().toList()).last, isA<PairingDenied>());
  });

  test('an expired or vanished request ends as expired', () async {
    for (final code in ['PAIR_EXPIRED', 'PAIR_NOT_FOUND']) {
      final api = FakePairingApi()..statusScript.add(ApiException(code, 410, code));
      expect((await flow(api).run().toList()).last, isA<PairingExpired>(), reason: code);
    }
  });

  test('a reveal the laptop rejects fails the flow without ever showing a code', () async {
    final api = FakePairingApi()..revealError = ApiException('COMMIT_MISMATCH', 400, 'mismatch');
    final events = await flow(api).run().toList();
    expect(events.single, isA<PairingFailed>());
    expect(api.statusCalls, 0);
  });

  test('an unreachable laptop or a certificate the phone did not see fails the flow', () async {
    expect((await flow(FakePairingApi()..requestError = const Unreachable()).run().toList()).single, isA<PairingFailed>());
    expect((await flow(FakePairingApi()..presentsNoCertificate = true).run().toList()).single, isA<PairingFailed>());
  });

  test('short network hiccups while polling are tolerated, five in a row fail', () async {
    final tolerated = FakePairingApi()
      ..statusScript.addAll([const Unreachable(), const Unreachable(), const Unreachable(), const Unreachable(), approved()]);
    expect((await flow(tolerated).run().toList()).last, isA<PairingApproved>());

    final dead = FakePairingApi()..statusScript.addAll(List.filled(5, const Unreachable()));
    expect((await flow(dead).run().toList()).last, isA<PairingFailed>());
  });

  test('a certificate change while polling fails the flow', () async {
    final api = FakePairingApi()..statusScript.add(const CertificateChanged());
    final last = (await flow(api).run().toList()).last as PairingFailed;
    expect(last.error, isA<CertificateChanged>());
  });

  test('cancel stops polling and ends the stream without a final event', () async {
    final api = FakePairingApi();
    late PairingFlow f;
    f = flow(api, wait: (d) async => f.cancel());
    final events = await f.run().toList();
    expect(events.single, isA<PairingWaiting>());
    expect(api.statusCalls, 1);
  });
}
