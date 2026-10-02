// Lokale Datenhaltung im Browser (IndexedDB). Nichts verlässt das Gerät.
//
// Store "cards":   { id, name, size, blob, text (null = noch nicht beschrieben), created, updated }
// Store "ignored": { id } – gelöschte Bilder, die bei künftigen Importen übersprungen werden

const DB_NAME = 'bild-karteikarten';
const DB_VERSION = 1;

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('cards', { keyPath: 'id' });
      db.createObjectStore('ignored', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await openDb();
  const t = db.transaction(stores, mode);
  // Abschluss-Handler vor der Arbeit anhängen, sonst kann "complete" verpasst werden
  const done = new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  const result = await fn(...[stores].flat().map((s) => t.objectStore(s)));
  await done;
  return result;
}

// Erkennung "schon bekannt": Dateiname + Originalgröße
export const imageId = (file) => `${file.name}|${file.size}`;

const byName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true });

export async function allCards() {
  const cards = await tx('cards', 'readonly', (s) => promisify(s.getAll()));
  return cards.sort(byName);
}

export async function knownIds() {
  return tx(['cards', 'ignored'], 'readonly', async (cards, ignored) => {
    const [a, b] = await Promise.all([promisify(cards.getAllKeys()), promisify(ignored.getAllKeys())]);
    return new Set([...a, ...b]);
  });
}

export async function putCard(card) {
  return tx('cards', 'readwrite', (s) => promisify(s.put(card)));
}

export async function setText(id, text) {
  return tx('cards', 'readwrite', async (s) => {
    const card = await promisify(s.get(id));
    if (!card) throw new Error('Karte nicht gefunden');
    const now = new Date().toISOString();
    Object.assign(card, { text, updated: now, created: card.created ?? now });
    await promisify(s.put(card));
    return card;
  });
}

export async function deleteCard(id, ignoreInFuture) {
  return tx(['cards', 'ignored'], 'readwrite', async (cards, ignored) => {
    await promisify(cards.delete(id));
    if (ignoreInFuture) await promisify(ignored.put({ id }));
  });
}

export async function clearAll() {
  return tx(['cards', 'ignored'], 'readwrite', async (cards, ignored) => {
    await Promise.all([promisify(cards.clear()), promisify(ignored.clear())]);
  });
}

export async function ignoredCount() {
  return tx('ignored', 'readonly', (s) => promisify(s.count()));
}

export async function clearIgnored() {
  return tx('ignored', 'readwrite', (s) => promisify(s.clear()));
}
