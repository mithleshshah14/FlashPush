'use strict';

const http = require('node:http');
const https = require('node:https');
const { fingerprintOfDer } = require('../../src/tls');

function collect(res, resolve, extra = {}) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    const buffer = Buffer.concat(chunks);
    let json = null;
    try {
      json = JSON.parse(buffer.toString('utf8'));
    } catch {
      /* not JSON */
    }
    resolve({ status: res.statusCode, headers: res.headers, json, text: buffer.toString('utf8'), buffer, ...extra });
  });
}

/** What the phone does: TLS to the laptop, remembering which certificate it was shown (to pin it). */
function tlsRequest(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, method, path, headers, rejectUnauthorized: false, agent: false }, (res) => {
      const fingerprint = fingerprintOfDer(res.socket.getPeerCertificate(true).raw);
      collect(res, resolve, { fingerprint });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function adminRequest(port, method, path, { headers = {}, body, json } = {}) {
  const h = { host: `127.0.0.1:${port}`, ...headers };
  if (method !== 'GET') h['x-flashpush-admin'] = '1';
  let payload = body;
  if (json !== undefined) {
    payload = JSON.stringify(json);
    h['content-type'] = 'application/json';
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: h, agent: false }, (res) => collect(res, resolve));
    req.on('error', reject);
    req.end(payload);
  });
}

module.exports = { tlsRequest, adminRequest };
