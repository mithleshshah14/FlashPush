import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Non-secret preferences.
class AppSettings {
  AppSettings(this._prefs);

  final SharedPreferences _prefs;

  static const defaultPhoneName = 'Android phone';

  String get phoneName => _prefs.getString('phoneName') ?? defaultPhoneName;

  /// False until a name has been set, by the user or by detecting the device model at startup.
  bool get hasPhoneName => _prefs.containsKey('phoneName');

  Future<void> setPhoneName(String name) => _prefs.setString('phoneName', name.trim().isEmpty ? defaultPhoneName : name.trim());

  ThemeMode get themeMode => ThemeMode.values.asNameMap()[_prefs.getString('themeMode')] ?? ThemeMode.system;

  Future<void> setThemeMode(ThemeMode mode) => _prefs.setString('themeMode', mode.name);

  /// The laptop the user asked to be connected to. It is kept across app restarts so the connection can be
  /// resumed, and cleared by Disconnect, Forget or connecting another laptop.
  String? get activeLaptopId => _prefs.getString('activeLaptopId');

  Future<void> setActiveLaptopId(String? id) => id == null ? _prefs.remove('activeLaptopId') : _prefs.setString('activeLaptopId', id);

  bool get autoReconnect => _prefs.getBool('autoReconnect') ?? true;

  Future<void> setAutoReconnect(bool value) => _prefs.setBool('autoReconnect', value);
}
