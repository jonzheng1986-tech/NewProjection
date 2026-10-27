// Entry point: boot the game, surface any startup error in the DOM overlay.

import { Game } from './game.js';

const canvas = document.getElementById('gl');
const bootEl = document.getElementById('boot');
const statusEl = document.getElementById('boot-status');
const errorEl = document.getElementById('error');

function showError(err) {
  console.error(err);
  if (!errorEl) return;
  errorEl.hidden = false;
  errorEl.innerHTML = '';
  const h = document.createElement('h1');
  h.textContent = 'New Projection failed to start';
  const pre = document.createElement('pre');
  pre.textContent = `${err && err.stack ? err.stack : err}`;
  errorEl.appendChild(h);
  errorEl.appendChild(pre);
}

window.addEventListener('error', (e) => showError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

try {
  const game = new Game(canvas);
  window.__game = game;
  game.boot();
  if (statusEl) statusEl.textContent = 'Ready';
  setTimeout(() => {
    if (bootEl) {
      bootEl.classList.add('hidden');
      setTimeout(() => bootEl.remove(), 800);
    }
  }, 260);
} catch (err) {
  showError(err);
}
