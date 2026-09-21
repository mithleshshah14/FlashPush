/// Delays between reconnect attempts: 2 s, 4 s, 8 s ... capped at 60 s.
class Backoff {
  Backoff({this.first = const Duration(seconds: 2), this.cap = const Duration(seconds: 60)}) : _next = first;

  final Duration first;
  final Duration cap;
  Duration _next;

  Duration next() {
    final current = _next;
    final doubled = _next * 2;
    _next = doubled > cap ? cap : doubled;
    return current;
  }

  void reset() => _next = first;
}
