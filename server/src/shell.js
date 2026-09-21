'use strict';

const { buildMenu } = require('./tray-protocol');
const { createItemNotifier } = require('./itemNotifier');

/**
 * Connects the running app to the tray: keeps its menu current, shows a balloon for a new pairing
 * request and one for what a phone sends while the admin site is not open, and turns the menu and
 * balloon clicks the tray sends back into actions. `onAction` is handed to the tray.
 */
function attachTray({ app, tray, autostart, desktop, adminUrl, onStop, log = () => {}, notifyDelayMs = 2500 }) {
  let lastSent = '';

  function autostartEnabled() {
    try {
      return autostart.isEnabled();
    } catch {
      return false;
    }
  }

  function refresh() {
    const model = buildMenu({
      status: app.lifecycle.status(),
      pendingCount: app.pairing.listPending().length,
      autostart: autostartEnabled(),
    });
    const json = JSON.stringify(model);
    if (json === lastSent) return;
    lastSent = json;
    tray.update(model);
  }

  const onPending = (view) => tray.notify('FlashPush', `${view.deviceName} wants to connect, code ${view.sasDisplay}`, 'approvals');

  const items = createItemNotifier({
    notify: (title, body, target) => tray.notify(title, body, target),
    isSiteOpen: () => app.admin.viewers() > 0,
    phoneName: (deviceId) => (app.devices.get(deviceId) || {}).name || 'A phone',
    delayMs: notifyDelayMs,
  });

  function toggleAutostart() {
    try {
      autostart.set(!autostartEnabled());
    } catch (err) {
      log(`Could not change Start with Windows: ${err.message}`);
    }
    refresh();
  }

  function onAction(id) {
    switch (id) {
      case 'open':
        desktop.openUrl(adminUrl);
        break;
      case 'approvals':
        desktop.openUrl(`${adminUrl}#/approvals`);
        break;
      case 'devices':
        desktop.openUrl(`${adminUrl}#/devices`);
        break;
      case 'messages': // a balloon about new messages: open the chat
        desktop.openUrl(`${adminUrl}#/messages`);
        break;
      case 'items': // a balloon about new files or images: open the dashboard, where they are listed
        desktop.openUrl(`${adminUrl}#/dashboard`);
        break;
      case 'files':
        desktop.openFolder(app.config.receiveDir);
        break;
      case 'autostart':
        toggleAutostart();
        break;
      case 'stop':
        onStop();
        break;
      default:
        break; // anything else is ignored
    }
  }

  app.bus.on('changed', refresh);
  app.pairing.on('pending', onPending);
  app.store.on('add', items.add);
  refresh();

  return {
    onAction,
    refresh,
    detach() {
      app.bus.off('changed', refresh);
      app.pairing.off('pending', onPending);
      app.store.off('add', items.add);
      items.dispose();
    },
  };
}

module.exports = { attachTray };
