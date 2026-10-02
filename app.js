import * as db from './db.js';

const $ = (id) => document.getElementById(id);

// Große Fotos werden beim Import verkleinert, um Speicher zu sparen.
const MAX_EDGE = 2048;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg|heic|heif)$/i;

// --- Hilfen ------------------------------------------------------------------

function toast(message, variant = 'danger') {
  const el = Object.assign(document.createElement('wa-callout'), { variant, className: 'toast' });
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 4500);
}

// Objekt-URLs pro Karte zwischenspeichern und beim Löschen freigeben
const urls = new Map();
function urlFor(card) {
  if (!urls.has(card.id)) urls.set(card.id, URL.createObjectURL(card.blob));
  return urls.get(card.id);
}
function releaseUrl(id) {
  if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
  urls.delete(id);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i ? 1 : 0).replace('.', ',')} ${units[i]}`;
}

// Gemeinsamer Zustand
const state = { cards: [] };
const described = () => state.cards.filter((c) => c.text);
const pending = () => state.cards.filter((c) => !c.text);

async function reload() {
  state.cards = await db.allCards();
  const n = described().length;
  const p = pending().length;
  $('stat-cards').textContent = plural(n, 'Karte', 'Karten');
  $('stat-pending').textContent = `${p} neu`;
  $('stat-pending').hidden = p === 0;
}

// --- Import ------------------------------------------------------------------

async function prepareImage(file) {
  const type = file.type || '';
  // Animationen und Vektorgrafiken unverändert übernehmen
  if (type === 'image/gif' || type === 'image/svg+xml') return file;

  const bitmap = await createImageBitmap(file); // wirft, wenn der Browser das Format nicht kennt
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const keepOriginal = scale === 1 && /^image\/(jpeg|png|webp|avif)$/.test(type);
  if (keepOriginal) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!blob) throw new Error('Konvertierung fehlgeschlagen');
  return blob;
}

async function importFiles(fileList) {
  const files = [...fileList].filter(
    (f) => !f.name.startsWith('.') && (f.type.startsWith('image/') || IMAGE_EXT.test(f.name)),
  );
  if (!files.length) return toast('Keine Bilder gefunden.', 'warning');

  const known = await db.knownIds();
  const fresh = files.filter((f) => !known.has(db.imageId(f)));
  const failed = [];

  $('import-progress').hidden = false;
  $('btn-pick-folder').disabled = $('btn-pick-files').disabled = true;
  try {
    for (const [i, file] of fresh.entries()) {
      $('import-status').textContent = `Lese ${i + 1} / ${fresh.length}: ${file.name}`;
      $('import-bar').value = (i / fresh.length) * 100;
      try {
        await db.putCard({
          id: db.imageId(file),
          name: file.name,
          size: file.size,
          blob: await prepareImage(file),
          text: null,
          created: null,
          updated: null,
        });
      } catch {
        failed.push(file.name);
      }
    }
  } finally {
    $('import-progress').hidden = true;
    $('btn-pick-folder').disabled = $('btn-pick-files').disabled = false;
  }

  // Beim ersten Import um dauerhaften Speicher bitten
  if (fresh.length) navigator.storage?.persist?.().then(updateStorageInfo);

  const added = fresh.length - failed.length;
  const skipped = files.length - fresh.length;
  const parts = [`${plural(added, 'neues Bild', 'neue Bilder')}`];
  if (skipped) parts.push(`${skipped} bereits bekannt`);
  toast(parts.join(', ') + '.', added ? 'success' : 'neutral');
  if (failed.length) {
    toast(`${plural(failed.length, 'Bild konnte', 'Bilder konnten')} nicht gelesen werden (Format nicht unterstützt): ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? ' …' : ''}`, 'warning');
  }

  await reload();
  startLabeling();
}

// --- Modus 1: Beschreiben ----------------------------------------------------

const label = { queue: [], index: 0 };

function startLabeling() {
  label.queue = pending();
  label.index = 0;
  showLabelItem();
}

function showLabelItem() {
  const { queue, index } = label;
  const done = index >= queue.length;
  $('label-card').hidden = done;
  $('label-empty').hidden = !done;

  if (done) {
    const left = pending().length;
    $('label-empty').variant = queue.length && !left ? 'success' : 'neutral';
    $('label-empty-text').textContent = !state.cards.length
      ? 'Noch keine Bilder. Wähle einen Ordner oder einzelne Bilder aus.'
      : left
        ? `${plural(left, 'Bild wartet', 'Bilder warten')} noch auf eine Beschreibung (übersprungen). Wechsle den Reiter und komm zurück, um sie erneut abzufragen.`
        : 'Alle Bilder sind beschrieben. Neue Bilder fügst du über „Ordner wählen“ oder „Bilder wählen“ hinzu.';
    return;
  }

  const card = queue[index];
  $('label-file').textContent = card.name;
  $('label-pos').textContent = `${index + 1} / ${queue.length}`;
  $('label-progress').value = (index / queue.length) * 100;
  $('label-img').src = urlFor(card);
  $('label-img').alt = card.name;
  $('label-text').value = '';
  requestAnimationFrame(() => $('label-text').focus());
}

async function saveLabel() {
  const text = ($('label-text').value ?? '').trim();
  if (!text) {
    $('label-text').focus();
    return toast('Bitte eine Beschreibung eingeben.', 'warning');
  }
  try {
    await db.setText(label.queue[label.index].id, text);
    await reload();
    learn.stale = true;
    label.index++;
    showLabelItem();
  } catch (err) {
    toast(err.message);
  }
}

function skipLabel() {
  label.index++;
  showLabelItem();
}

// --- Modus 2: Lernen ---------------------------------------------------------

const learn = { deck: [], pos: 0, round: 1, revealed: false, stale: true };

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newDeck(lastId) {
  learn.deck = shuffle(described());
  // Gleiches Bild nicht direkt zweimal hintereinander zeigen
  if (learn.deck.length > 1 && learn.deck[0].id === lastId) learn.deck.push(learn.deck.shift());
  learn.pos = 0;
}

function startLearning() {
  learn.round = 1;
  learn.stale = false;
  newDeck();
  showLearnCard();
}

const currentCard = () => learn.deck[learn.pos];

function showLearnCard() {
  const empty = learn.deck.length === 0;
  $('learn-empty').hidden = !empty;
  $('learn-card').hidden = empty;
  if (empty) return;

  learn.revealed = false;
  $('learn-img').src = urlFor(currentCard());
  $('learn-round').textContent = learn.round;
  $('learn-pos').textContent = `${learn.pos + 1} / ${learn.deck.length}`;
  $('learn-answer').classList.remove('revealed');
  $('learn-answer').innerHTML = '<span class="quiet">?</span>';
  $('btn-reveal').hidden = false;
  $('btn-next').hidden = true;
  $('btn-edit').hidden = true;
}

function reveal() {
  learn.revealed = true;
  $('learn-answer').textContent = currentCard().text;
  $('learn-answer').classList.add('revealed');
  $('btn-reveal').hidden = true;
  $('btn-next').hidden = false;
  $('btn-edit').hidden = false;
}

function nextCard() {
  learn.pos++;
  if (learn.pos >= learn.deck.length) {
    learn.round++;
    newDeck(learn.deck.at(-1)?.id);
  }
  showLearnCard();
}

// --- Bearbeiten (gemeinsam für Lernen und Liste) ------------------------------

let editing = null; // { card, onSaved }

function openEdit(card, onSaved) {
  editing = { card, onSaved };
  $('edit-text').value = card.text;
  $('edit-dialog').open = true;
}

async function saveEdit() {
  const { card, onSaved } = editing;
  const text = ($('edit-text').value ?? '').trim();
  if (!text) return toast('Beschreibung darf nicht leer sein.', 'warning');
  try {
    await db.setText(card.id, text);
    card.text = text;
    onSaved?.(text);
    $('edit-dialog').open = false;
  } catch (err) {
    toast(err.message);
  }
}

// --- Modus 3: Kartenliste ----------------------------------------------------

let deleting = null;

function renderList() {
  const q = ($('list-filter').value ?? '').trim().toLowerCase();
  const all = described();
  const shown = all.filter((c) => !q || c.text.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));

  $('list-empty').hidden = shown.length > 0;
  $('list-empty-text').textContent = all.length ? 'Keine Karte passt zur Suche.' : 'Noch keine Karten vorhanden.';

  $('list').replaceChildren(
    ...shown.map((card) => {
      const li = document.createElement('li');
      li.className = 'card-row';
      li.innerHTML = `
        <img class="thumb" alt="" />
        <div class="card-info">
          <div class="card-text"></div>
          <div class="wa-caption-s quiet filename"></div>
        </div>
        <div class="wa-cluster wa-gap-2xs">
          <wa-button appearance="plain" size="small" data-action="edit" title="Bearbeiten">
            <wa-icon name="pen" label="Bearbeiten"></wa-icon>
          </wa-button>
          <wa-button appearance="plain" variant="danger" size="small" data-action="delete" title="Löschen">
            <wa-icon name="trash" label="Löschen"></wa-icon>
          </wa-button>
        </div>`;
      li.querySelector('.thumb').src = urlFor(card);
      li.querySelector('.card-text').textContent = card.text;
      li.querySelector('.filename').textContent = card.name;
      li.querySelector('[data-action=edit]').addEventListener('click', () =>
        openEdit(card, (text) => {
          li.querySelector('.card-text').textContent = text;
          learn.stale = true;
        }),
      );
      li.querySelector('[data-action=delete]').addEventListener('click', () => openDelete(card));
      return li;
    }),
  );
}

function openDelete(card) {
  deleting = card;
  $('delete-file').textContent = card.name;
  $('delete-ignore').checked = true;
  $('delete-dialog').open = true;
}

async function confirmDelete() {
  try {
    await db.deleteCard(deleting.id, $('delete-ignore').checked);
    releaseUrl(deleting.id);
    await reload();
    renderList();
    learn.stale = true;
    $('delete-dialog').open = false;
  } catch (err) {
    toast(err.message);
  }
}

// --- Modus 4: Daten & Sicherung ----------------------------------------------

async function updateStorageInfo() {
  const est = await navigator.storage?.estimate?.();
  $('storage-usage').textContent = est
    ? `${plural(state.cards.length, 'Bild', 'Bilder')} · belegt ca. ${formatBytes(est.usage)} von verfügbaren ${formatBytes(est.quota)}`
    : `${plural(state.cards.length, 'Bild', 'Bilder')}`;

  const persisted = await navigator.storage?.persisted?.();
  $('persist-callout').variant = persisted ? 'success' : 'warning';
  $('persist-callout').querySelector('wa-icon').name = persisted ? 'circle-check' : 'triangle-exclamation';
  $('persist-text').textContent = persisted
    ? 'Dauerhafter Speicher ist aktiv: Der Browser löscht die Daten nicht von sich aus (außer du löschst die Websitedaten selbst).'
    : 'Speicher ist nicht als dauerhaft markiert. Der Browser darf die Daten bei Platzmangel löschen; Safari löscht sie nach 7 Tagen ohne Nutzung, wenn die App nicht zum Home-Bildschirm/Dock hinzugefügt ist. Exportiere regelmäßig eine Sicherung.';
  $('btn-persist').hidden = !!persisted || !navigator.storage?.persist;

  const ignored = await db.ignoredCount();
  $('ignored-text').textContent = `${plural(ignored, 'Bild steht', 'Bilder stehen')} auf der Ignorierliste (gelöscht und beim Import übersprungen).`;
  $('btn-clear-ignored').disabled = ignored === 0;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function exportBackup() {
  if (!state.cards.length) return toast('Keine Daten zum Exportieren.', 'warning');
  $('btn-export').loading = true;
  try {
    // Als Teile zusammensetzen, um keinen riesigen String im Speicher zu bauen
    const parts = [`{"app":"bild-karteikarten","version":1,"exported":"${new Date().toISOString()}","cards":[`];
    for (const [i, c] of state.cards.entries()) {
      const { blob, ...meta } = c;
      parts.push((i ? ',' : '') + JSON.stringify({ ...meta, data: await blobToDataUrl(blob) }));
    }
    parts.push(']}');
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `karteikarten-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    toast(err.message);
  } finally {
    $('btn-export').loading = false;
  }
}

async function importBackup(file) {
  $('btn-import').loading = true;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'bild-karteikarten' || !Array.isArray(data.cards)) throw new Error('Keine gültige Sicherungsdatei.');

    const existing = new Map(state.cards.map((c) => [c.id, c]));
    let added = 0;
    let updated = 0;
    for (const c of data.cards) {
      const old = existing.get(c.id);
      if (old && (old.updated ?? '') >= (c.updated ?? '')) continue; // vorhandene Karte ist neuer
      const blob = await (await fetch(c.data)).blob();
      await db.putCard({ id: c.id, name: c.name, size: c.size, blob, text: c.text, created: c.created, updated: c.updated });
      releaseUrl(c.id);
      old ? updated++ : added++;
    }
    await reload();
    learn.stale = true;
    startLabeling();
    updateStorageInfo();
    toast(`Import fertig: ${added} neu, ${updated} aktualisiert.`, 'success');
  } catch (err) {
    toast(err instanceof SyntaxError ? 'Datei ist kein gültiges JSON.' : err.message);
  } finally {
    $('btn-import').loading = false;
  }
}

async function clearAll() {
  await db.clearAll();
  [...urls.keys()].forEach(releaseUrl);
  await reload();
  learn.stale = true;
  startLabeling();
  updateStorageInfo();
  $('clear-dialog').open = false;
  toast('Alle Daten gelöscht.', 'neutral');
}

// --- Verdrahtung -------------------------------------------------------------

// Ordnerauswahl gibt es auf iPhone/iPad nicht
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
$('btn-pick-folder').hidden = isIOS;
if (isIOS) $('btn-pick-files').setAttribute('appearance', 'accent');

$('btn-pick-folder').addEventListener('click', () => $('input-folder').click());
$('btn-pick-files').addEventListener('click', () => $('input-files').click());
for (const id of ['input-folder', 'input-files']) {
  $(id).addEventListener('change', (e) => {
    importFiles(e.target.files);
    e.target.value = '';
  });
}

$('btn-save').addEventListener('click', saveLabel);
$('btn-skip').addEventListener('click', skipLabel);
$('label-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveLabel();
  }
});

$('btn-reveal').addEventListener('click', reveal);
$('btn-next').addEventListener('click', nextCard);
$('learn-img').addEventListener('click', () => (learn.revealed ? nextCard() : reveal()));
$('btn-edit').addEventListener('click', () =>
  openEdit(currentCard(), (text) => ($('learn-answer').textContent = text)),
);
$('btn-edit-save').addEventListener('click', saveEdit);

$('list-filter').addEventListener('input', renderList);
$('list-filter').addEventListener('wa-clear', renderList);
$('btn-delete-confirm').addEventListener('click', confirmDelete);

$('btn-persist').addEventListener('click', async () => {
  const ok = await navigator.storage.persist();
  if (!ok) toast('Der Browser hat dauerhaften Speicher abgelehnt. Installiere die App (Home-Bildschirm/Dock) oder nutze sie regelmäßig.', 'warning');
  updateStorageInfo();
});
$('btn-export').addEventListener('click', exportBackup);
$('btn-import').addEventListener('click', () => $('input-backup').click());
$('input-backup').addEventListener('change', (e) => {
  if (e.target.files[0]) importBackup(e.target.files[0]);
  e.target.value = '';
});
$('btn-clear-ignored').addEventListener('click', async () => {
  await db.clearIgnored();
  updateStorageInfo();
  toast('Ignorierliste geleert.', 'neutral');
});
$('btn-clear-all').addEventListener('click', () => ($('clear-dialog').open = true));
$('btn-clear-confirm').addEventListener('click', clearAll);

$('modes').addEventListener('wa-tab-show', (e) => {
  const name = e.detail.name;
  if (name === 'label' && label.index >= label.queue.length) startLabeling();
  if (name === 'learn' && learn.stale) startLearning();
  if (name === 'list') renderList();
  if (name === 'data') updateStorageInfo();
});

// Leertaste im Lernmodus: aufdecken bzw. weiter
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || $('modes').active !== 'learn' || $('learn-card').hidden) return;
  if ([...document.querySelectorAll('wa-dialog')].some((d) => d.open)) return;
  if (e.composedPath().some((el) => el.tagName === 'WA-TEXTAREA' || el.tagName === 'WA-INPUT')) return;
  e.preventDefault();
  learn.revealed ? nextCard() : reveal();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

try {
  await reload();
  startLabeling();
} catch (err) {
  toast(`Lokaler Speicher nicht verfügbar: ${err.message}`);
}
