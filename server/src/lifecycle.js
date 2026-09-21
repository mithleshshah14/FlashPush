'use strict';

const { EventEmitter } = require('node:events');

/** starting -> running | degraded -> stopped (final). Emits 'change' with the new status. */
class Lifecycle extends EventEmitter {
  constructor() {
    super();
    this.state = 'starting';
    this.reason = null;
  }

  status() {
    return { state: this.state, reason: this.reason };
  }

  _set(state, reason = null) {
    if (this.state === 'stopped' || (this.state === state && this.reason === reason)) return;
    this.state = state;
    this.reason = reason;
    this.emit('change', this.status());
  }

  running() {
    this._set('running');
  }

  degraded(reason) {
    this._set('degraded', reason);
  }

  stopped() {
    this._set('stopped');
  }
}

/** A human sentence for a failed listen, shown in the tray and the admin page. */
function listenFailureReason(err, port, protocol = 'TCP') {
  const label = protocol === 'TCP' ? 'Port' : `${protocol} port`;
  if (err.code === 'EADDRINUSE') return `${label} ${err.port || port} is used by another program.`;
  return `Could not listen on port ${port}: ${err.message}`;
}

const isEventStream = (req) => /\/events(\?|$)/.test(req.url || '');

/** Counts in-flight requests (event streams excluded) so a graceful stop can wait for them. */
function createTracker() {
  let active = 0;
  const waiters = new Set();

  const settle = () => {
    if (active === 0) for (const wake of [...waiters]) wake(true);
  };

  function attach(server) {
    server.on('request', (req, res) => {
      if (isEventStream(req)) return;
      active++;
      let counted = true;
      const done = () => {
        if (!counted) return;
        counted = false;
        active--;
        settle();
      };
      res.on('close', done);
      res.on('finish', done);
    });
  }

  function whenIdle(ms) {
    if (active === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const wake = (value) => {
        clearTimeout(timer);
        waiters.delete(wake);
        resolve(value);
      };
      const timer = setTimeout(() => wake(false), ms);
      waiters.add(wake);
    });
  }

  return { attach, whenIdle };
}

module.exports = { Lifecycle, listenFailureReason, createTracker };
