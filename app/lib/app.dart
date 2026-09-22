import 'dart:async';

import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'core/errors.dart';
import 'core/models.dart';
import 'native.dart';
import 'net/connection.dart';
import 'theme.dart';
import 'ui/devices_page.dart';
import 'ui/laptop_detail_page.dart';
import 'ui/pairing_page.dart';
import 'ui/platform_actions.dart';
import 'ui/settings_page.dart';
import 'ui/transfer_tab.dart';

class FlashPushApp extends StatelessWidget {
  const FlashPushApp({super.key, required this.controller, required this.actions, required this.shares, required this.takePendingShares});

  final AppController controller;
  final PlatformActions actions;

  /// Shares sent from other apps while FlashPush is open, and those that arrived before the UI was up.
  final Stream<SharePayload> shares;
  final List<SharePayload> Function() takePendingShares;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) => MaterialApp(
        title: 'FlashPush',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(Brightness.light),
        darkTheme: buildTheme(Brightness.dark),
        themeMode: controller.themeMode,
        home: HomeShell(controller: controller, actions: actions, shares: shares, takePendingShares: takePendingShares),
      ),
    );
  }
}

/// The three tabs (Devices, Transfer, Settings). Discovery only runs while the Devices tab is on screen.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.controller, required this.actions, required this.shares, required this.takePendingShares});

  final AppController controller;
  final PlatformActions actions;
  final Stream<SharePayload> shares;
  final List<SharePayload> Function() takePendingShares;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  static const _devices = 0;
  int _tab = _devices;
  StreamSubscription<SharePayload>? _shareSubscription;
  StreamSubscription<(LaptopConnection, Item)>? _incomingSubscription;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Discovery notifies listeners straight away, which is not allowed while the tree is still building.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _tab == _devices) widget.controller.discovery.start();
    });
    _shareSubscription = widget.shares.listen(_onShare);
    for (final payload in widget.takePendingShares()) {
      _onShare(payload);
    }
    _incomingSubscription = widget.controller.incomingItems.listen(_onIncoming);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _shareSubscription?.cancel();
    _incomingSubscription?.cancel();
    widget.controller.discovery.stop();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (_tab == _devices) widget.controller.discovery.start();
    } else {
      widget.controller.discovery.stop();
    }
  }

  void _selectTab(int index) {
    setState(() => _tab = index);
    if (index == _devices) {
      widget.controller.discovery.start();
    } else {
      widget.controller.discovery.stop();
    }
  }

  void _say(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  void _onIncoming((LaptopConnection, Item) event) {
    final (connection, item) = event;
    if (!mounted) return;
    final what = item.isImage ? 'an image' : item.isFile ? 'a file' : 'a message';
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text('${connection.laptop.name} sent $what'),
        action: SnackBarAction(label: 'Open', onPressed: () => _openDetail(connection)),
      ));
  }

  Future<void> _onShare(SharePayload payload) async {
    try {
      final result = await widget.controller.handleShare(payload);
      if (result == ShareResult.sent) {
        _say('Sent to laptop');
      } else {
        _say('Connect to a laptop first, then share again.');
        _selectTab(_devices);
      }
    } on Object catch (error) {
      _say(userMessage(error));
    }
  }

  void _openDetail(LaptopConnection connection) {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => LaptopDetailPage(controller: widget.controller, laptopId: connection.laptop.id, actions: widget.actions, onRePair: _pair),
    ));
  }

  Future<void> _pair(String host, int port) async {
    final connection = await Navigator.of(context).push<LaptopConnection>(
      MaterialPageRoute(builder: (_) => PairingPage(controller: widget.controller, host: host, port: port)),
    );
    if (connection != null && mounted) _openDetail(connection);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _tab,
        children: [
          DevicesPage(controller: widget.controller, onOpenLaptop: _openDetail, onPair: _pair),
          TransferTab(controller: widget.controller, actions: widget.actions, onGoToDevices: () => _selectTab(_devices), onRePair: _pair),
          SettingsPage(controller: widget.controller, actions: widget.actions, onRePair: _pair),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: _selectTab,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.laptop_mac_outlined), selectedIcon: Icon(Icons.laptop_mac), label: 'Devices'),
          NavigationDestination(icon: Icon(Icons.swap_horiz), label: 'Transfer'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Settings'),
        ],
      ),
    );
  }
}
