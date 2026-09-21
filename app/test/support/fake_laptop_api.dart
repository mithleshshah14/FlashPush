import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flashpush/core/errors.dart';
import 'package:flashpush/core/laptop_api.dart';
import 'package:flashpush/core/models.dart';
import 'package:flashpush/core/sse.dart';

/// A scriptable stand-in for the laptops on the network. One instance is shared by every fake
/// [LaptopApi] it hands out, so tests can script reachability, sessions and events per address.
class FakeNetwork {
  String laptopId = 'laptop-1';
  String laptopName = 'MITHLESH-PC';

  /// Addresses that cannot be reached, and addresses that present another certificate.
  final Set<String> unreachableHosts = {};
  final Set<String> wrongCertificateHosts = {};

  /// Scripted answers for successive `connect` calls (a Session-less success when the queue is empty).
  final List<Object> connectScript = [];
  List<LaptopAddress> sessionAddresses = const [LaptopAddress(host: '192.168.1.6', port: 8765, kind: 'lan')];

  List<Item> items = [];
  final List<Object> itemsScript = []; // exceptions thrown by successive `items` calls
  final List<Object> sendScript = []; // exceptions thrown by successive sends

  int helloCalls = 0;
  int connectCalls = 0;
  int downloadCalls = 0;
  final List<String> disconnected = [];
  final List<String> forgotten = [];
  final List<String> sentTexts = [];
  final List<String> operationIds = [];
  final List<FakeLaptopApi> apis = [];
  StreamController<SseEvent>? events;
  int eventsOpened = 0;

  LaptopApi apiFor(String host, int port, Uint8List? pin) {
    final api = FakeLaptopApi(this, host, port);
    apis.add(api);
    return api;
  }

  void emit(String event, Map<String, dynamic> data) => events!.add(SseEvent(event, data));

  Item textItem(String id, {String from = 'laptop', DateTime? time}) =>
      Item(id: id, kind: 'text', from: from, time: time ?? DateTime(2026, 1, 1), text: id);
}

class FakeLaptopApi implements LaptopApi {
  FakeLaptopApi(this.network, this.host, this.port);

  final FakeNetwork network;
  @override
  final String host;
  @override
  final int port;
  bool closed = false;

  @override
  Uint8List? get seenFingerprint => null;

  @override
  void close() => closed = true;

  @override
  Future<Hello> hello() async {
    network.helloCalls++;
    if (network.wrongCertificateHosts.contains(host)) throw const CertificateChanged();
    if (network.unreachableHosts.contains(host)) throw const Unreachable();
    await Future<void>.delayed(Duration.zero);
    return Hello(laptopId: network.laptopId, name: network.laptopName);
  }

  @override
  Future<Session> connect({required String deviceId, required String secret}) async {
    network.connectCalls++;
    if (network.connectScript.isNotEmpty) {
      final next = network.connectScript.removeAt(0);
      if (next is Exception) throw next;
    }
    return Session(
      token: 'token-${network.connectCalls}',
      expiresAt: DateTime(2030),
      laptop: Hello(laptopId: network.laptopId, name: network.laptopName),
      addresses: network.sessionAddresses,
    );
  }

  @override
  Future<void> disconnect(String token) async => network.disconnected.add(token);

  @override
  Future<void> forget(String token) async => network.forgotten.add(token);

  @override
  Future<List<Item>> items(String token) async {
    if (network.itemsScript.isNotEmpty) {
      final next = network.itemsScript.removeAt(0);
      if (next is Exception) throw next;
    }
    return [...network.items];
  }

  @override
  Stream<SseEvent> events(String token) {
    network.eventsOpened++;
    return (network.events = StreamController<SseEvent>()).stream;
  }

  void _maybeFail() {
    if (network.sendScript.isNotEmpty) {
      final next = network.sendScript.removeAt(0);
      if (next is Exception) throw next;
    }
  }

  @override
  Future<Item> sendText(String token, String text, String operationId) async {
    network.operationIds.add(operationId);
    _maybeFail();
    network.sentTexts.add(text);
    return network.textItem('sent-${network.sentTexts.length}', from: 'phone');
  }

  @override
  Future<Item> sendFile(String token, File file, String name, String operationId, {Progress? onProgress}) async {
    network.operationIds.add(operationId);
    _maybeFail();
    final size = await file.length();
    onProgress?.call(size, size);
    return Item(id: 'file-${network.operationIds.length}', kind: 'file', from: 'phone', time: DateTime(2026), name: name, size: size, mime: 'application/octet-stream');
  }

  @override
  Future<File> download(String token, Item item, Directory dir, {Progress? onProgress}) async {
    network.downloadCalls++;
    final file = File('${dir.path}${Platform.pathSeparator}${item.id}');
    await file.writeAsBytes([1, 2, 3]);
    return file;
  }

  @override
  Future<void> deleteItem(String token, String id) async {}

  @override
  Future<PairRequest> pairRequest({required String deviceId, required String deviceName, required Uint8List commit}) =>
      throw UnimplementedError('pairing is tested in pairing_test.dart');

  @override
  Future<void> pairReveal({required String requestId, required Uint8List np}) => throw UnimplementedError();

  @override
  Future<PairStatus> pairStatus({required String requestId, required String deviceId, required String proof}) => throw UnimplementedError();
}
