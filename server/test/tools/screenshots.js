'use strict';

// Screenshots of the admin UI (needs Chrome and a running demo server):
//   node test/tools/demo-server.js 8761        (in one terminal)
//   node test/tools/screenshots.js 8761 ../docs/design/implemented
// Drives a private headless Chrome profile over the DevTools protocol; only the process it starts is stopped.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = process.argv[2] || '8761';
const outDir = path.resolve(process.argv[3] || 'screenshots');
const debugPort = 9333 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHOTS = [
  ['dashboard', 'desktop', 1440, 900],
  ['approvals', 'desktop', 1440, 900],
  ['devices', 'desktop', 1440, 900],
  ['dashboard', 'mobile', 390, 844],
  ['approvals', 'mobile', 390, 844],
  ['devices', 'mobile', 390, 844],
];

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* Chrome is still starting */
    }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'flashpush-chrome-'));
  const chrome = spawn(CHROME, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  try {
    const ws = new WebSocket(await connect());
    await new Promise((resolve) => ws.addEventListener('open', resolve));
    let id = 0;
    const pending = new Map();
    const problems = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
      if (msg.method === 'Runtime.exceptionThrown') problems.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') problems.push(msg.params.args.map((a) => a.value || a.description).join(' '));
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') problems.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`);
    });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Log.enable');

    for (const theme of ['dark', 'light']) {
      await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      for (const [view, kind, width, height] of SHOTS) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: kind === 'mobile' });
        await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/#/${view}` });
        await sleep(300);
        await cdp('Page.reload', { ignoreCache: true });
        await sleep(1500);
        const layout = await cdp('Page.getLayoutMetrics');
        const content = layout.cssContentSize || layout.contentSize;
        const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.max(height, Math.ceil(content.height)), scale: 1 } });
        const file = path.join(outDir, `${view}-${kind}-${theme}.png`);
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
        const overflow = await cdp('Runtime.evaluate', { expression: 'document.documentElement.scrollWidth > document.documentElement.clientWidth', returnByValue: true });
        console.log(`${path.basename(file)}${overflow.result.value ? '  (HORIZONTAL OVERFLOW)' : ''}`);
      }
    }
    console.log(problems.length ? `Console problems:\n${[...new Set(problems)].join('\n')}` : 'No console errors.');
    ws.close();
  } finally {
    chrome.kill();
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
