import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'app_controller.dart';
import 'core/http_laptop_api.dart';
import 'data/app_settings.dart';
import 'data/history_cache.dart';
import 'data/laptop_store.dart';
import 'data/secret_store.dart';
import 'native.dart';
import 'net/discovery.dart';
import 'ui/platform_actions.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final support = await getApplicationSupportDirectory();

  final controller = AppController(
    store: LaptopStore(prefs, const FlutterSecretStore()),
    settings: AppSettings(prefs),
    cache: HistoryCache(Directory('${support.path}${Platform.pathSeparator}history')),
    apiFor: (host, port, pin) => HttpLaptopApi(host, port, pin: pin),
    discovery: DiscoveryController(scanForLaptops),
  );
  await controller.init();

  final native = Native.instance;
  await native.loadInitialShare();
  runApp(FlashPushApp(
    controller: controller,
    actions: PlatformActions.system(),
    shares: native.shares,
    takePendingShares: native.takePending,
  ));
}
