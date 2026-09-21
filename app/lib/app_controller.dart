import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import 'core/models.dart';
import 'data/app_settings.dart';
import 'data/history_cache.dart';
import 'data/laptop_store.dart';
import 'native.dart';
import 'net/connection.dart';
import 'net/discovery.dart';
import 'net/link_state.dart';
import 'net/pairing.dart';
import 'net/transfer.dart' as transfer;

/// One line of the Devices list: a saved laptop, a discovered one, or both.
class LaptopRow {
  const LaptopRow({required this.id, required this.name, required this.host, required this.state, required this.route, required this.wifiUp, this.connection, this.discovered});

  final String id;
  final String name;
  final String? host;
  final LinkState state;
  final RouteKind route;
  final bool wifiUp;
  final LaptopConnection? connection; // null while not paired
  final DiscoveredLaptop? discovered;

  bool get paired => connection != null;
}

enum ShareResult { sent, needsConnection }

/// App-wide state: saved laptops and their connections (only one is active at a time),
/// discovery, settings, lifecycle. Screens read it and call its methods; it holds no UI.
class AppController extends ChangeNotifier with WidgetsBindingObserver {
  AppController({
    required this.store,
    required this.settings,
    required this.cache,
    required this.apiFor,
    required this.discovery,
    this.pairingWait,
  });

  final LaptopStore store;
  final AppSettings settings;
  final HistoryCache cache;
  final ApiFactory apiFor;
  final DiscoveryController discovery;

  /// How the pairing flow waits between polls (a test seam; real timers by default).
  final Future<void> Function(Duration)? pairingWait;

  final Map<String, LaptopConnection> _connections = {};
  late String _deviceId;
  bool _foreground = true;

  Future<void> init() async {
    _deviceId = await store.deviceId();
    for (final laptop in store.laptops) {
      final credentials = await store.credentialsFor(laptop.id);
      if (credentials == null) {
        await store.remove(laptop.id); // a laptop without a secret can never connect
        continue;
      }
      await _adopt(laptop, credentials);
    }
    discovery.addListener(_onDiscovery);
    WidgetsBinding.instance.addObserver(this);
    notifyListeners();
  }

  Future<LaptopConnection> _adopt(Laptop laptop, Credentials credentials) async {
    final connection = LaptopConnection(
      laptop: laptop,
      deviceId: _deviceId,
      credentials: credentials,
      apiFor: apiFor,
      store: store,
      cache: cache,
      autoReconnect: () => settings.autoReconnect,
    )..addListener(notifyListeners);
    await connection.loadCached();
    await connection.setForeground(_foreground);
    _connections[laptop.id] = connection;
    return connection;
  }

  // ---- what the screens show ------------------------------------------------------

  /// Connected first, then paired, then laptops that are only seen on the network.
  List<LaptopRow> get rows {
    final rows = <LaptopRow>[
      for (final c in _connections.values)
        LaptopRow(
          id: c.laptop.id,
          name: c.laptop.name,
          host: c.laptop.lastHost ?? (c.laptop.addresses.isEmpty ? null : c.laptop.addresses.first.host),
          state: c.state,
          route: c.route,
          wifiUp: c.wifiUp,
          connection: c,
          discovered: _discovered(c.laptop.id),
        ),
      for (final d in discovery.results)
        if (!_connections.containsKey(d.laptopId))
          LaptopRow(id: d.laptopId, name: d.name, host: d.host, state: LinkState.notPaired, route: RouteKind.none, wifiUp: false, discovered: d),
    ];
    int rank(LaptopRow r) => r.state == LinkState.connected ? 0 : (r.paired ? 1 : 2);
    return rows..sort((a, b) => rank(a).compareTo(rank(b)));
  }

  DiscoveredLaptop? _discovered(String id) {
    for (final d in discovery.results) {
      if (d.laptopId == id) return d;
    }
    return null;
  }

  /// The laptop the phone is connected to (or connecting to), for the Transfer tab and share intents.
  LaptopConnection? get active {
    for (final c in _connections.values) {
      if (c.state == LinkState.connected || c.state == LinkState.connecting) return c;
    }
    return null;
  }

  LaptopConnection? connectionFor(String id) => _connections[id];

  void _onDiscovery() {
    // A saved laptop seen at a new address: remember it for later connects.
    for (final d in discovery.results) {
      final connection = _connections[d.laptopId];
      if (connection != null) {
        unawaited(connection.learnAddress(LaptopAddress(host: d.host, port: d.port, kind: 'lan')));
      }
    }
    notifyListeners();
  }

  // ---- connecting -------------------------------------------------------------------

  /// Only one laptop is connected at a time: connecting one ends the others.
  Future<void> connect(String id) async {
    final connection = _connections[id];
    if (connection == null) return;
    for (final other in _connections.values) {
      if (other != connection && other.state != LinkState.paired) await other.disconnect();
    }
    await connection.connect();
  }

  Future<void> disconnect(String id) async => _connections[id]?.disconnect();

  // ---- pairing ----------------------------------------------------------------------

  /// A pairing attempt against [host]:[port] (a discovered laptop or an address typed by the user).
  PairingFlow beginPairing(String host, int port) =>
      PairingFlow(api: apiFor(host, port, null), deviceId: _deviceId, deviceName: settings.phoneName, wait: pairingWait);

  /// Saves an approved pairing and connects at once. A re-pair replaces the old credentials.
  Future<LaptopConnection> finishPairing(PairingApproved approved) async {
    _connections.remove(approved.laptop.id)?.dispose();
    await store.save(approved.laptop, credentials: approved.credentials);
    final connection = await _adopt(approved.laptop, approved.credentials);
    notifyListeners();
    unawaited(connect(approved.laptop.id));
    return connection;
  }

  /// Where to pair again with a laptop (Re-pair). A successful pairing replaces the old credentials;
  /// cancelling leaves everything as it was.
  LaptopAddress? addressOf(String id) {
    final laptop = _connections[id]?.laptop;
    if (laptop == null) return null;
    return laptop.addresses.where((a) => a.host == laptop.lastHost).firstOrNull ?? laptop.addresses.firstOrNull;
  }

  /// Forgets the laptop everywhere: its credentials, its history and its row.
  Future<void> forget(String id) async {
    final connection = _connections.remove(id);
    if (connection == null) return;
    await connection.forget();
    connection.dispose();
    notifyListeners();
  }

  // ---- settings -----------------------------------------------------------------------

  ThemeMode get themeMode => settings.themeMode;

  Future<void> setThemeMode(ThemeMode mode) async {
    await settings.setThemeMode(mode);
    notifyListeners();
  }

  Future<void> setPhoneName(String name) async {
    await settings.setPhoneName(name);
    notifyListeners();
  }

  Future<void> setAutoReconnect(bool value) async {
    await settings.setAutoReconnect(value);
    notifyListeners();
  }

  // ---- lifecycle and shares -------------------------------------------------------------

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final foreground = state == AppLifecycleState.resumed;
    if (foreground == _foreground) return;
    _foreground = foreground;
    for (final c in _connections.values) {
      unawaited(c.setForeground(foreground));
    }
  }

  /// Sends what another app shared to the connected laptop.
  Future<ShareResult> handleShare(SharePayload payload) async {
    final connection = active;
    if (connection == null || !connection.connected) return ShareResult.needsConnection;
    final text = payload.text;
    if (text != null && text.trim().isNotEmpty) await transfer.sendText(connection, text);
    for (final file in payload.files) {
      await transfer.sendFile(connection, File(file.path), file.name);
    }
    return ShareResult.sent;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    discovery.removeListener(_onDiscovery);
    for (final c in _connections.values) {
      c.dispose();
    }
    super.dispose();
  }
}
