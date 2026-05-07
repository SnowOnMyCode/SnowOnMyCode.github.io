// Soft passcode gate. NOT real security — the source is public on GitHub
// and a determined visitor can bypass this in DevTools. It exists only to
// keep the demo URL from being casually shared.
//
// To change the code:
//   1. Open any browser DevTools console and run:
//        crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR_NEW_CODE'))
//          .then(b => console.log([...new Uint8Array(b)]
//            .map(x => x.toString(16).padStart(2,'0')).join('')))
//   2. Replace EXPECTED_HASH below with the printed value.

const EXPECTED_HASH =
  'c2b9adcc58d851a1708da8f81c7c8bdcfb774fdfdb82eb98af07f503f78f1107'; // "biolek"

const STORAGE_KEY = 'snn_unlocked_v1';

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function unlock() {
  document.body.classList.remove('locked');
  const gate = document.getElementById('gate');
  if (gate) gate.remove();
  if (typeof window.startApp === 'function') window.startApp();
}

async function tryUnlock() {
  const input = document.getElementById('gate-input');
  const err = document.getElementById('gate-error');
  err.textContent = '';
  const v = (input.value || '').trim();
  if (!v) return;
  const h = await sha256Hex(v);
  if (h === EXPECTED_HASH) {
    sessionStorage.setItem(STORAGE_KEY, '1');
    unlock();
  } else {
    err.textContent = 'Incorrect code';
    input.select();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem(STORAGE_KEY) === '1') {
    unlock();
    return;
  }
  document.getElementById('gate-submit').addEventListener('click', tryUnlock);
  document.getElementById('gate-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); tryUnlock(); }
  });
  document.getElementById('gate-input').focus();
});
