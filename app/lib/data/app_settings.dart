import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Non-secret preferences.
class AppSettings {
  AppSettings(this._prefs);

  final SharedPreferences _prefs;

  static const defaultPhoneName = 'Android phone';

  String get phoneName => _prefs.getString('phoneName') ?? defaultPhoneName;

  Future<void> setPhoneName(String name) => _prefs.setString('phoneName', name.trim().isEmpty ? defaultPhoneName : name.trim());

  ThemeMode get themeMode => ThemeMode.values.asNameMap()[_prefs.getString('themeMode')] ?? ThemeMode.system;

  Future<void> setThemeMode(ThemeMode mode) => _prefs.setString('themeMode', mode.name);

  bool get autoReconnect => _prefs.getBool('autoReconnect') ?? true;

  Future<void> setAutoReconnect(bool value) => _prefs.setBool('autoReconnect', value);
}
