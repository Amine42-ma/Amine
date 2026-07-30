import { boot } from '../boot.js';
import { LocalHost } from './host.js';
import { clearSnapshot } from './storage.js';
import { $ } from '../ui/dom.js';

/**
 * Entry point for the single downloadable file. The world is created and
 * simulated right here in the page — no server, no network, works offline —
 * and progress is kept in localStorage between sessions.
 */

const host = new LocalHost();

// Offline play has nobody to authenticate against, so the credentials UI is
// hidden rather than removed — the shared boot code still wires it up.
const passwordInput = $<HTMLInputElement>('gate-pass');
passwordInput.required = false;
passwordInput.value = 'offline';
(passwordInput.closest('label') as HTMLElement | null)?.style.setProperty('display', 'none');
$('gate-login').style.display = 'none';

void boot({
  offline: true,
  transport: { send: (msg) => host.send(msg), onMessage: (fn) => host.onMessage(fn) },
  tiles: () => host.tiles(),
}).then(() => {
  host.start();
  addResetControl();
});

/** A way out of a world you no longer want, without clearing browser data by hand. */
function addResetControl() {
  const button = document.createElement('button');
  button.className = 'lang-toggle';
  button.style.cssText = 'position:fixed;bottom:8px;inset-inline-end:10px;z-index:30;opacity:.5';
  button.textContent = '↻';
  button.title = 'New world / عالم جديد';
  button.addEventListener('click', () => {
    const ok = confirm(
      'ابدأ عالماً جديداً؟ ستفقد كل تقدمك.\n\nStart a new world? All progress will be lost.',
    );
    if (!ok) return;
    clearSnapshot();
    location.reload();
  });
  document.body.appendChild(button);
}
