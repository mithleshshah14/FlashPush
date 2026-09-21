// Live updates: the server only says "something changed"; the UI then refetches the state.
const CLOSED = 2;

export function startLive({ onChange, onOnline, onOffline, retryMs = 3000 }) {
  let source = null;
  let offline = false;
  let timer = null;
  let stopped = false;

  function connect() {
    source = new EventSource('/admin/events');
    source.onopen = () => {
      offline = false;
      onOnline();
      onChange();
    };
    source.addEventListener('changed', onChange);
    source.onerror = () => {
      if (!offline) {
        offline = true;
        onOffline();
      }
      // The browser retries by itself unless it gave up (for example after a server restart).
      if (source.readyState === CLOSED && !stopped) {
        source.close();
        timer = setTimeout(connect, retryMs);
      }
    };
  }

  connect();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      source.close();
    },
  };
}
