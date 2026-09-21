'use strict';

/** A controllable clock for time-dependent tests. */
function createClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
}

module.exports = { createClock };
