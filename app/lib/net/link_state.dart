/// Where a laptop stands from the phone's side (docs/connection-state.md).
enum LinkState {
  /// Seen on the network or added by address, never approved.
  notPaired,

  /// Paired, no connection wanted right now.
  paired,
  connecting,
  connected,
  disconnecting,

  /// Connection wanted but the laptop cannot be reached; retrying.
  unreachable,

  /// The laptop presented a different certificate than the pinned one. Terminal until re-paired.
  certChanged,

  /// The laptop no longer knows this phone (revoked or forgotten). Terminal until re-paired.
  unpaired,
}

/// How the current connection reaches the laptop.
enum RouteKind { none, wifi, tailscale }
