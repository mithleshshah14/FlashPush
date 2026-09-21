'use strict';

const { buildMenu } = require('./tray-protocol');

/**
 * Connects the running app to the tray: keeps its menu current, shows a balloon for a new pairing
 * request, and turns the menu clicks the tray sends back into actions. `onAction` is handed to the tray.
 */
function attachTray({ app, tray, autostart, desktop, adminUrl, onStop, log = () => {} }) {
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

  const onPending = (view) => tray.notify('FlashPush', `${view.deviceName} wants to connect, code ${view.sasDisplay}`);

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
      case 'approvals': // the approvals are on the admin page
      case 'devices':
        desktop.openUrl(adminUrl);
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
  refresh();

  return {
    onAction,
    refresh,
    detach() {
      app.bus.off('changed', refresh);
      app.pairing.off('pending', onPending);
    },
  };
}

module.exports = { attachTray };
