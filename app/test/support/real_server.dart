import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// The real laptop server (`server/src/index.js`), loopback only, on ephemeral ports in a temp folder.
class RealServer {
  RealServer._(this._process, this._dir, this.devicePort, this.adminPort, this.discoveryPort, this.receiveDir);

  final Process _process;
  final Directory _dir;
  final int devicePort;
  final int adminPort;
  final int discoveryPort;
  final Directory receiveDir;

  /// Returns null when Node.js is not installed, so callers can skip.
  static Future<RealServer?> start() async {
    try {
      await Process.run('node', ['--version']);
    } on ProcessException {
      return null;
    }
    final dir = await Directory.systemTemp.createTemp('flashpush-it-');
    final receive = Directory('${dir.path}${Platform.pathSeparator}received')..createSync();
    // loopback_server.js runs the real server with every listener on 127.0.0.1 only.
    final process = await Process.start(
      'node',
      ['test/support/loopback_server.js'],
      environment: {'FLASHPUSH_HOME': dir.path, 'RECEIVE_DIR': receive.path},
    );
    final output = StringBuffer();
    final ready = Completer<void>();
    void onLine(String line) {
      output.writeln(line);
      if (!ready.isCompleted && RegExp(r'HTTPS on port \d+; discovery listens on UDP \d+').hasMatch(output.toString())) {
        ready.complete();
      }
    }

    process.stdout.transform(utf8.decoder).transform(const LineSplitter()).listen(onLine);
    process.stderr.transform(utf8.decoder).transform(const LineSplitter()).listen(onLine);
    try {
      await ready.future.timeout(const Duration(seconds: 20));
    } on TimeoutException {
      process.kill();
      throw StateError('The server did not start:\n$output');
    }
    int port(RegExp pattern) => int.parse(pattern.firstMatch(output.toString())!.group(1)!);
    return RealServer._(
      process,
      dir,
      port(RegExp(r'HTTPS on port (\d+)')),
      port(RegExp(r'http://127\.0\.0\.1:(\d+)')),
      port(RegExp(r'UDP (\d+)')),
      receive,
    );
  }

  /// Calls the loopback admin API the way the admin page does.
  Future<Map<String, dynamic>> admin(String method, String path, {Map<String, dynamic>? body}) async {
    final client = HttpClient();
    try {
      final request = await client.openUrl(method, Uri.parse('http://127.0.0.1:$adminPort$path'));
      if (method != 'GET') request.headers.set('x-flashpush-admin', '1');
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(body));
      }
      final response = await request.close();
      final text = await utf8.decoder.bind(response).join();
      return text.isEmpty ? {} : jsonDecode(text) as Map<String, dynamic>;
    } finally {
      client.close(force: true);
    }
  }

  Future<void> stop() async {
    await _process.stdin.close(); // the launcher shuts the server down when its stdin ends
    _process.kill();
    await _process.exitCode.timeout(const Duration(seconds: 5), onTimeout: () => -1);
    try {
      await _dir.delete(recursive: true);
    } on FileSystemException {
      // Windows may still hold a file for a moment; the temp folder is disposable.
    }
  }
}
