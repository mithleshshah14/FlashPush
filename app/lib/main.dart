import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'home_page.dart';
import 'native.dart';
import 'pairing_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final url = prefs.getString('baseUrl');
  final token = prefs.getString('token');
  final saved = (url != null && token != null) ? Connection(url, token) : null;
  Native.instance.loadInitialShare();
  runApp(FlashPushApp(prefs: prefs, initial: saved));
}

class FlashPushApp extends StatefulWidget {
  const FlashPushApp({super.key, required this.prefs, this.initial});

  final SharedPreferences prefs;
  final Connection? initial;

  @override
  State<FlashPushApp> createState() => _FlashPushAppState();
}

class _FlashPushAppState extends State<FlashPushApp> {
  late Connection? _connection = widget.initial;

  Future<void> _setConnection(Connection? c) async {
    if (c == null) {
      await widget.prefs.remove('baseUrl');
      await widget.prefs.remove('token');
    } else {
      await widget.prefs.setString('baseUrl', c.baseUrl);
      await widget.prefs.setString('token', c.token);
    }
    setState(() => _connection = c);
  }

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF5B5BF0);
    final connection = _connection;
    return MaterialApp(
      title: 'FlashPush',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: seed, useMaterial3: true),
      darkTheme: ThemeData(colorSchemeSeed: seed, brightness: Brightness.dark, useMaterial3: true),
      home: connection == null
          ? PairingPage(onPaired: _setConnection)
          : HomePage(
              key: ValueKey('${connection.baseUrl}${connection.token}'),
              connection: connection,
              onDisconnect: () => _setConnection(null),
            ),
    );
  }
}
