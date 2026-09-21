import 'dart:async';

/// Lets a probe learn that it lost the race, so it can close its socket.
class CancelToken {
  final List<void Function()> _callbacks = [];
  bool _cancelled = false;

  bool get cancelled => _cancelled;

  void onCancel(void Function() callback) {
    if (_cancelled) {
      callback();
    } else {
      _callbacks.add(callback);
    }
  }

  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    for (final callback in _callbacks) {
      callback();
    }
  }
}

class RaceWinner<C, T> {
  const RaceWinner(this.candidate, this.value);

  final C candidate;
  final T value;
}

/// Probes all [candidates] at once and returns the first that succeeds; every other probe is
/// cancelled at once. A probe that fails or exceeds [timeout] is a loser, so one dead address
/// never delays the others. Returns null when none succeeds.
Future<RaceWinner<C, T>?> raceAddresses<C, T>(
  List<C> candidates,
  Future<T> Function(C candidate, CancelToken cancel) probe, {
  Duration timeout = const Duration(seconds: 3),
}) {
  if (candidates.isEmpty) return Future.value();
  final result = Completer<RaceWinner<C, T>?>();
  final tokens = [for (final _ in candidates) CancelToken()];
  var pending = candidates.length;

  void finishCandidate() {
    if (--pending == 0 && !result.isCompleted) result.complete();
  }

  for (var i = 0; i < candidates.length; i++) {
    probe(candidates[i], tokens[i]).timeout(timeout).then<void>((value) {
      if (result.isCompleted) return;
      result.complete(RaceWinner(candidates[i], value));
      for (var j = 0; j < tokens.length; j++) {
        if (j != i) tokens[j].cancel();
      }
    }).catchError((Object _) {
      tokens[i].cancel(); // failed or timed out: release its resources
    }).whenComplete(finishCandidate);
  }
  return result.future;
}
