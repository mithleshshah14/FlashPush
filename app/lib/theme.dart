import 'package:flutter/material.dart';

/// Colours that Material's ColorScheme has no slot for (design tokens: .stitch/DESIGN.md §2).
@immutable
class FlashColors extends ThemeExtension<FlashColors> {
  const FlashColors({
    required this.on,
    required this.off,
    required this.warning,
    required this.tailscale,
    required this.cyan,
    required this.hairline,
  });

  final Color on; // connection ON (mint)
  final Color off; // connection OFF (neutral grey)
  final Color warning;
  final Color tailscale;
  final Color cyan;
  final Color hairline;

  static const dark = FlashColors(
    on: Color(0xFF16F9CB),
    off: Color(0xFF6B7FA3),
    warning: Color(0xFFFFB547),
    tailscale: Color(0xFF8B5CF6),
    cyan: Color(0xFF45E2FD),
    hairline: Color(0x3345E2FD),
  );

  static const light = FlashColors(
    on: Color(0xFF0BB58F),
    off: Color(0xFF6B7FA3),
    warning: Color(0xFFB45309),
    tailscale: Color(0xFF5B54F6),
    cyan: Color(0xFF007A99),
    hairline: Color(0xFFD5E3F7),
  );

  @override
  FlashColors copyWith({Color? on, Color? off, Color? warning, Color? tailscale, Color? cyan, Color? hairline}) => FlashColors(
        on: on ?? this.on,
        off: off ?? this.off,
        warning: warning ?? this.warning,
        tailscale: tailscale ?? this.tailscale,
        cyan: cyan ?? this.cyan,
        hairline: hairline ?? this.hairline,
      );

  @override
  FlashColors lerp(FlashColors? other, double t) => t < 0.5 ? this : (other ?? this);
}

extension FlashTheme on BuildContext {
  FlashColors get flash => Theme.of(this).extension<FlashColors>()!;
}

/// Monospace for addresses, sizes and the pairing code.
const monoFamily = 'monospace';

const _radius = 12.0;

ThemeData buildTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = dark
      ? const ColorScheme(
          brightness: Brightness.dark,
          primary: Color(0xFF1CA2FD),
          onPrimary: Color(0xFF03142F),
          secondary: Color(0xFF16F9CB),
          onSecondary: Color(0xFF03142F),
          tertiary: Color(0xFF0346F4),
          error: Color(0xFFFF6B6B),
          onError: Color(0xFF2A0A0A),
          surface: Color(0xFF0A1B3D),
          onSurface: Color(0xFFE8F0FF),
          onSurfaceVariant: Color(0xFF9DB2D6),
          surfaceContainerHighest: Color(0xFF112B58),
          outline: Color(0xFF6B7FA3),
          outlineVariant: Color(0xFF1E3A63),
        )
      : const ColorScheme(
          brightness: Brightness.light,
          primary: Color(0xFF0346F4),
          onPrimary: Colors.white,
          secondary: Color(0xFF0BB58F),
          onSecondary: Colors.white,
          tertiary: Color(0xFF1CA2FD),
          error: Color(0xFFE5484D),
          onError: Colors.white,
          surface: Color(0xFFFFFFFF),
          onSurface: Color(0xFF0A1B3D),
          onSurfaceVariant: Color(0xFF4F6790),
          surfaceContainerHighest: Color(0xFFEAF1FB),
          outline: Color(0xFF6B7FA3),
          outlineVariant: Color(0xFFD5E3F7),
        );
  final flash = dark ? FlashColors.dark : FlashColors.light;
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(_radius));

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: dark ? const Color(0xFF030C1E) : const Color(0xFFF4F8FF),
    extensions: [flash],
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      foregroundColor: scheme.onSurface,
      titleTextStyle: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: scheme.onSurface),
    ),
    cardTheme: CardThemeData(
      color: scheme.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(_radius), side: BorderSide(color: flash.hairline)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: scheme.surface,
      indicatorColor: flash.cyan.withValues(alpha: 0.18),
      labelTextStyle: WidgetStatePropertyAll(TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
    ),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(shape: shape, minimumSize: const Size(48, 48))),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(shape: shape, minimumSize: const Size(48, 48), side: BorderSide(color: flash.hairline))),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(_radius)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: scheme.surfaceContainerHighest,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    ),
    tabBarTheme: TabBarThemeData(
      labelColor: flash.cyan,
      unselectedLabelColor: scheme.onSurfaceVariant,
      indicatorColor: flash.cyan,
      dividerColor: flash.hairline,
    ),
  );
}
