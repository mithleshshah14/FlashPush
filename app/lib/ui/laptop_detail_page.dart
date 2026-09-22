import 'dart:async';

import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/models.dart';
import '../net/connection.dart';
import '../net/link_state.dart';
import '../net/transfer_queue.dart';
import 'connection_controls.dart';
import 'file_list.dart';
import 'image_grid.dart';
import 'message_composer.dart';
import 'message_list.dart';
import 'platform_actions.dart';
import 'problem_view.dart';
import 'send_action.dart';

/// One laptop: its history split into Messages, Images and Files, and a center button that sends for the current tab.
/// With no connection the saved history stays readable; sending needs a connection.
class LaptopDetailPage extends StatefulWidget {
  const LaptopDetailPage({
    super.key,
    required this.controller,
    required this.laptopId,
    required this.actions,
    required this.onRePair,
    this.showBack = true,
  });

  final AppController controller;
  final String laptopId;
  final PlatformActions actions;

  /// Called with the laptop's last address, so pairing can start again (the old pairing is replaced on success).
  final void Function(String host, int port) onRePair;
  final bool showBack;

  @override
  State<LaptopDetailPage> createState() => _LaptopDetailPageState();
}

class _LaptopDetailPageState extends State<LaptopDetailPage> with SingleTickerProviderStateMixin {
  final TransferQueue _queue = TransferQueue();
  late final TabController _tabs = TabController(length: 3, vsync: this)..addListener(_onTabChanged);
  StreamSubscription<Item>? _incomingSub;
  final List<int> _unread = [0, 0, 0]; // Messages, Images, Files - cleared when that tab is open

  @override
  void initState() {
    super.initState();
    _incomingSub = widget.controller.connectionFor(widget.laptopId)?.incoming.listen(_onIncoming);
  }

  void _onTabChanged() {
    if (_unread[_tabs.index] != 0) setState(() => _unread[_tabs.index] = 0);
  }

  /// A tab you're not looking at gets a count; the one you're on doesn't need one, its list already shows the item.
  void _onIncoming(Item item) {
    final tab = item.isImage ? 1 : item.isFile ? 2 : 0;
    if (tab == _tabs.index) return;
    setState(() => _unread[tab]++);
  }

  @override
  void dispose() {
    _incomingSub?.cancel();
    _tabs.dispose();
    _queue.dispose();
    super.dispose();
  }

  Future<void> _openLink(String url) async {
    final messenger = ScaffoldMessenger.of(context);
    final opened = await widget.actions.openLink(url);
    if (!opened) messenger.showSnackBar(const SnackBar(content: Text('Could not open the link.')));
  }

  void _rePair() {
    final address = widget.controller.addressOf(widget.laptopId);
    if (address != null) widget.onRePair(address.host, address.port);
  }

  Future<void> _forget() async {
    await widget.controller.forget(widget.laptopId);
    if (mounted && widget.showBack) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final connection = widget.controller.connectionFor(widget.laptopId);
    if (connection == null) {
      // The laptop was forgotten: leave this screen.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && Navigator.of(context).canPop()) Navigator.of(context).pop();
      });
      return const Scaffold();
    }
    return ListenableBuilder(
      listenable: Listenable.merge([connection, _queue]),
      builder: (context, _) {
        final state = connection.state;
        final problem = state == LinkState.unpaired || state == LinkState.certChanged;
        final linked = state == LinkState.connected || state == LinkState.connecting;
        final items = connection.items;
        return Scaffold(
          appBar: AppBar(
            automaticallyImplyLeading: widget.showBack,
            title: Text(connection.laptop.name, overflow: TextOverflow.ellipsis),
            actions: [
              ConnectionControls(
                state: state,
                route: connection.route,
                wifiUp: connection.wifiUp,
                onLinkPressed: () => linked ? widget.controller.disconnect(widget.laptopId) : widget.controller.connect(widget.laptopId),
              ),
              const SizedBox(width: 12),
            ],
            bottom: problem
                ? null
                : TabBar(controller: _tabs, tabs: [
                    _TabLabel('Messages', _unread[0]),
                    _TabLabel('Images', _unread[1]),
                    _TabLabel('Files', _unread[2]),
                  ]),
          ),
          body: problem
              ? ProblemView(state: state, onRePair: _rePair, onForget: _forget)
              : Column(
                  children: [
                    if (!connection.connected && state != LinkState.connecting) const _OfflineBanner(),
                    for (final entry in _queue.entries) _UploadRow(entry: entry, onDismiss: () => _queue.dismiss(entry)),
                    Expanded(
                      child: TabBarView(controller: _tabs, children: [
                        Column(
                          children: [
                            Expanded(child: MessageList(items: items.where((i) => i.isText).toList(), onOpenLink: _openLink)),
                            if (connection.connected) MessageComposer(connection: connection),
                          ],
                        ),
                        ImageGrid(connection: connection, items: items.where((i) => i.isImage).toList(), saver: widget.actions.saveToDownloads),
                        FileList(connection: connection, items: items.where((i) => i.isFile).toList(), saver: widget.actions.saveToDownloads),
                      ]),
                    ),
                  ],
                ),
          floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
          floatingActionButton: problem
              ? null
              : connection.connected
                  ? _SendButton(tabs: _tabs, connection: connection, queue: _queue, actions: widget.actions)
                  : FloatingActionButton.extended(
                      key: const Key('connect-to-send'),
                      onPressed: state == LinkState.connecting ? null : () => widget.controller.connect(widget.laptopId),
                      icon: const Icon(Icons.link),
                      label: const Text('Connect to send'),
                    ),
        );
      },
    );
  }
}

/// The center button: its label and what it opens follow the selected tab (message, image or file).
class _SendButton extends StatelessWidget {
  const _SendButton({required this.tabs, required this.connection, required this.queue, required this.actions});

  final TabController tabs;
  final LaptopConnection connection;
  final TransferQueue queue;
  final PlatformActions actions;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: tabs,
      builder: (context, _) {
        final kind = SendKind.forTab(tabs.index);
        if (kind == SendKind.message) return const SizedBox.shrink(); // the Messages tab sends through its own composer
        return FloatingActionButton.extended(
          key: Key(kind.key),
          onPressed: () => startSend(context, kind, connection: connection, queue: queue, actions: actions),
          icon: Icon(kind.icon),
          label: Text(kind.label),
        );
      },
    );
  }
}

/// A tab label with a small count badge when there is unseen content on that tab.
class _TabLabel extends StatelessWidget {
  const _TabLabel(this.text, this.count);

  final String text;
  final int count;

  @override
  Widget build(BuildContext context) {
    if (count == 0) return Tab(text: text);
    return Tab(child: Badge.count(count: count, alignment: AlignmentDirectional.topEnd, child: Text(text)));
  }
}

class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner();

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        child: Text('Showing saved history', style: Theme.of(context).textTheme.bodySmall),
      );
}

class _UploadRow extends StatelessWidget {
  const _UploadRow({required this.entry, required this.onDismiss});

  final TransferEntry entry;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final failed = entry.error != null;
    return ListTile(
      dense: true,
      leading: Icon(failed ? Icons.error_outline : Icons.upload, color: failed ? Theme.of(context).colorScheme.error : null),
      title: Text(entry.label, overflow: TextOverflow.ellipsis),
      subtitle: failed ? Text(entry.error!) : LinearProgressIndicator(value: entry.progress),
      trailing: failed ? IconButton(icon: const Icon(Icons.close), tooltip: 'Dismiss', onPressed: onDismiss) : null,
    );
  }
}
