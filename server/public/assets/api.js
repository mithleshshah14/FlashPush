// The only network entry points of the UI. Every write carries the admin header the server requires.
import { errorMessage } from './model.js';

const ADMIN_HEADER = { 'X-FlashPush-Admin': '1' };
const GENERIC_ERROR = 'Something went wrong. Please try again.';

async function unwrap(res) {
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(json, GENERIC_ERROR));
  return json;
}

export async function getState() {
  return unwrap(await fetch('/admin/state'));
}

export async function send(method, path, body) {
  const headers = { ...ADMIN_HEADER };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return unwrap(await fetch(path, init));
}

/** Uploads a file to a phone. XMLHttpRequest (not fetch) because it reports upload progress. */
export function uploadFile({ file, deviceId, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/admin/file');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-FlashPush-Admin', '1');
    if (deviceId) xhr.setRequestHeader('X-Device-Id', deviceId);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let json = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(json);
      else reject(new Error(errorMessage(json, GENERIC_ERROR)));
    };
    xhr.onerror = () => reject(new Error('Could not reach FlashPush.'));
    xhr.send(file);
  });
}
