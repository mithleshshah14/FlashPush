'use strict';

const NAMES = { message: ['message', 'messages'], image: ['image', 'images'], file: ['file', 'files'] };
const ARTICLE = { message: 'a message', image: 'an image', file: 'a file' };

const kindOf = (item) => (item.kind === 'text' ? 'message' : String(item.mime || '').startsWith('image/') ? 'image' : 'file');

/**
 * The balloon text and where a click should lead. It names the phone and the kinds of items but never
 * quotes a message or a file name: notifications can be seen on a locked or shared screen.
 */
function describe(phone, counts) {
  const kinds = Object.keys(NAMES).filter((kind) => counts[kind] > 0);
  const total = kinds.reduce((sum, kind) => sum + counts[kind], 0);
  const body =
    total === 1
      ? `${phone} sent ${ARTICLE[kinds[0]]}`
      : `${phone} sent ${total} items: ${kinds.map((kind) => `${counts[kind]} ${NAMES[kind][counts[kind] === 1 ? 0 : 1]}`).join(', ')}`;
  // Only messages: open the chat. Anything with a file or an image: open the dashboard, where those are listed.
  const target = counts.message > 0 && counts.image + counts.file === 0 ? 'messages' : 'items';
  return { title: 'FlashPush', body, target };
}

/**
 * Turns items arriving from a phone into at most one notification per phone per burst, and stays silent
 * while the admin site is open (the user is looking at it). Timers are injectable for tests.
 */
function createItemNotifier({ notify, isSiteOpen, phoneName, delayMs = 2500, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const batches = new Map(); // deviceId -> { counts, timer }

  function flush(deviceId) {
    const batch = batches.get(deviceId);
    if (!batch) return;
    batches.delete(deviceId);
    if (isSiteOpen()) return;
    const { title, body, target } = describe(phoneName(deviceId), batch.counts);
    notify(title, body, target);
  }

  function add({ item, deviceId }) {
    if (item.from !== 'phone' || isSiteOpen()) return;
    let batch = batches.get(deviceId);
    if (!batch) {
      const timer = setTimer(() => flush(deviceId), delayMs);
      if (timer && timer.unref) timer.unref();
      batch = { counts: { message: 0, image: 0, file: 0 }, timer };
      batches.set(deviceId, batch);
    }
    batch.counts[kindOf(item)] += 1;
  }

  function dispose() {
    for (const batch of batches.values()) clearTimer(batch.timer);
    batches.clear();
  }

  return { add, dispose };
}

module.exports = { createItemNotifier, describe };
