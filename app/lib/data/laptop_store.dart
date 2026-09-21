import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../core/models.dart';
import '../core/protocol_crypto.dart';
import 'secret_store.dart';

/// Saved laptops (names and addresses in preferences) and their credentials (in the secret store).
class LaptopStore {
  LaptopStore(this._prefs, this._secrets);

  final SharedPreferences _prefs;
  final SecretStore _secrets;

  static const _laptopsKey = 'laptops';
  static const _deviceKey = 'deviceId';

  /// This phone's permanent id, created on first use.
  Future<String> deviceId() async {
    final existing = await _secrets.read(_deviceKey);
    if (existing != null) return existing;
    final created = newUuid();
    await _secrets.write(_deviceKey, created);
    return created;
  }

  List<Laptop> get laptops {
    final raw = _prefs.getString(_laptopsKey);
    if (raw == null) return const [];
    try {
      return [for (final l in jsonDecode(raw) as List<dynamic>) Laptop.fromJson(l as Map<String, dynamic>)];
    } on Object {
      return const []; // unreadable preferences are treated as "nothing saved"
    }
  }

  Laptop? laptop(String id) {
    for (final l in laptops) {
      if (l.id == id) return l;
    }
    return null;
  }

  /// Adds or updates a laptop. [credentials] are stored (or replaced) only when given.
  Future<void> save(Laptop laptop, {Credentials? credentials}) async {
    final others = laptops.where((l) => l.id != laptop.id);
    await _prefs.setString(_laptopsKey, jsonEncode([for (final l in [...others, laptop]) l.toJson()]));
    if (credentials != null) {
      await _secrets.write('secret.${laptop.id}', credentials.secret);
      await _secrets.write('pin.${laptop.id}', b64uEncode(credentials.fingerprint));
    }
  }

  Future<Credentials?> credentialsFor(String laptopId) async {
    final secret = await _secrets.read('secret.$laptopId');
    final pin = await _secrets.read('pin.$laptopId');
    if (secret == null || pin == null) return null;
    try {
      return Credentials(secret: secret, fingerprint: b64uDecode(pin, 32));
    } on FormatException {
      return null;
    }
  }

  /// Forgets a laptop completely, including its credentials.
  Future<void> remove(String laptopId) async {
    await _prefs.setString(_laptopsKey, jsonEncode([for (final l in laptops.where((l) => l.id != laptopId)) l.toJson()]));
    await _secrets.delete('secret.$laptopId');
    await _secrets.delete('pin.$laptopId');
  }
}
