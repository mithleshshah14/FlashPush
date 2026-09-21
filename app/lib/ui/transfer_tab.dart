import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../theme.dart';
import 'laptop_detail_page.dart';
import 'platform_actions.dart';

/// The Transfer tab is a shortcut: the detail screen of the connected laptop, or a prompt to connect one.
class TransferTab extends StatelessWidget {
  const TransferTab({super.key, required this.controller, required this.actions, required this.onGoToDevices, required this.onRePair});

  final AppController controller;
  final PlatformActions actions;
  final VoidCallback onGoToDevices;
  final void Function(String host, int port) onRePair;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final active = controller.active;
        if (active != null) {
          return LaptopDetailPage(
            key: ValueKey(active.laptop.id),
            controller: controller,
            laptopId: active.laptop.id,
            actions: actions,
            onRePair: onRePair,
            showBack: false,
          );
        }
        return Scaffold(
          appBar: AppBar(title: const Text('Transfer')),
          body: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.swap_horiz, size: 64, color: context.flash.cyan),
                  const SizedBox(height: 16),
                  Text('Connect a laptop first', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 8),
                  const Text('Pick a laptop on the Devices tab, then send text, images and files here.', textAlign: TextAlign.center),
                  const SizedBox(height: 24),
                  FilledButton(key: const Key('go-to-devices'), onPressed: onGoToDevices, child: const Text('Go to Devices')),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
