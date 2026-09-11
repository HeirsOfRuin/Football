// Persistence. Saved games live in IndexedDB (large quota, structured clone);
// small things — settings and the custom player library — live in localStorage
// so they are trivial to export and survive a cleared save.

import { serialiseGame, deserialiseGame, saveMeta } from './codec.js';

// Persisted identifiers are a contract with data already on the player's
// device. Renaming any of these orphans every existing save or library without
// an error — treat a change here as needing a migration, not a rename.
const DB_NAME = 'touchline';
const DB_VERSION = 1;
const SAVE_STORE = 'saves';
const SAVE_INDEX_KEY = 'touchline.saveIndex';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB support.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SAVE_STORE)) {
        db.createObjectStore(SAVE_STORE, { keyPath: 'slot' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try {
      result = fn(s);
    } catch (err) {
      reject(err);
      return;
    }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export async function saveGame(slot, game) {
  const payload = serialiseGame(game);
  payload.slot = slot;
  await tx(SAVE_STORE, 'readwrite', (s) => s.put(payload));
  const index = listSaveIndex();
  index[slot] = { slot, ...payload.meta, savedAt: payload.savedAt };
  localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(index));
  return payload.meta;
}

export async function loadGame(slot) {
  const data = await tx(SAVE_STORE, 'readonly', (s) => s.get(slot));
  if (!data) return null;
  return deserialiseGame(data);
}

export async function deleteSave(slot) {
  await tx(SAVE_STORE, 'readwrite', (s) => s.delete(slot));
  const index = listSaveIndex();
  delete index[slot];
  localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(index));
}

export function listSaveIndex() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_INDEX_KEY) || '{}');
  } catch {
    return {};
  }
}

export async function listSaves() {
  try {
    const all = await tx(SAVE_STORE, 'readonly', (s) => s.getAll());
    return (all || []).map((d) => ({ slot: d.slot, ...d.meta, savedAt: d.savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return Object.values(listSaveIndex()).sort((a, b) => b.savedAt - a.savedAt);
  }
}

/** Download a save as a JSON file the player can keep or move between browsers. */
export function exportGameFile(game) {
  const payload = serialiseGame(game);
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const meta = payload.meta;
  a.href = url;
  a.download = `touchline-${meta.club.replace(/\W+/g, '-').toLowerCase()}-s${meta.season}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function importGameFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data.players || !data.world) throw new Error('That file is not a Touchline save.');
  return deserialiseGame(data);
}

// --- Settings ---------------------------------------------------------------

const SETTINGS_KEY = 'touchline.settings';

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export { saveMeta };
