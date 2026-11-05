// Personal data for the signed-in visitor, kept private by the backend's policies:
//   marks       visited / interested / note per startup
//   boothNotes  an exhibitor's notes about people who visited their own booth
//   notes       general notes, not tied to a startup
// All are cached per account on this device (so they work with a flaky connection) and
// synced to the Langrove backend; newest edit wins. Signing out clears the device cache.

const LEGACY_KEY = 'sn26.marks.v1'; // marks saved before sign-in existed
const SYNC_DELAY_MS = 1000;

const readJSON = (key) => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};
const writeJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or storage full: data still syncs to the account */
  }
};
const removeKey = (key) => {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
};

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('').replace(/(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && (data.detail || data.error)) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// One synced collection: an object of items keyed by id, each with changed_at.
class Collection {
  constructor(store, { name, endpoint, field, keyOf }) {
    Object.assign(this, { store, name, endpoint, field, keyOf });
    this.items = {};
    this.dirty = new Set();
    this.timer = null;
  }

  get cacheKey() { return `sn26.${this.store.user.id}.${this.name}`; }

  load() {
    this.items = readJSON(this.cacheKey) || {};
    this.dirty = new Set(readJSON(`${this.cacheKey}.dirty`) || []);
  }

  save() {
    writeJSON(this.cacheKey, this.items);
    writeJSON(`${this.cacheKey}.dirty`, [...this.dirty]);
  }

  clear(forget) {
    clearTimeout(this.timer);
    if (forget && this.store.user) {
      removeKey(this.cacheKey);
      removeKey(`${this.cacheKey}.dirty`);
    }
    this.items = {};
    this.dirty = new Set();
  }

  put(id, item) {
    this.items[id] = { ...item, changed_at: Date.now() };
    this.dirty.add(id);
    this.save();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), SYNC_DELAY_MS);
  }

  absorb(list) {
    let changed = false;
    for (const s of list || []) {
      const id = this.keyOf(s);
      const local = this.items[id];
      if (!local || (s.changed_at || 0) > (local.changed_at || 0)) {
        const { startup, ...rest } = s;
        this.items[id] = this.name === 'marks' ? rest : s;
        changed = true;
      }
    }
    if (changed) this.save();
    return changed;
  }

  async push(all = false) {
    if (!this.store.user) return;
    const ids = all ? Object.keys(this.items) : [...this.dirty];
    if (!ids.length && !all) return;
    const payload = {};
    for (const id of ids) if (this.items[id]) payload[id] = this.items[id];
    this.store.setSync('syncing');
    try {
      const res = await api('PUT', this.endpoint, { [this.field]: payload });
      ids.forEach((id) => this.dirty.delete(id));
      const changed = this.absorb(res[this.field]);
      this.save();
      this.store.setSync('synced');
      if (changed) this.store.emit('change', { collection: this.name });
    } catch (e) {
      this.store.handleSyncError(e, () => this.push());
    }
  }
}

export class MarkStore extends EventTarget {
  constructor() {
    super();
    this.user = null;          // { id, email, own_startup, welcomed } when signed in
    this.syncState = 'idle';
    this.backend = location.protocol.startsWith('http');
    this.marks = new Collection(this, { name: 'marks', endpoint: '/marks', field: 'marks', keyOf: (m) => m.startup });
    this.boothNotes = new Collection(this, { name: 'booth-notes', endpoint: '/booth-notes', field: 'notes', keyOf: (n) => n.id });
    this.notes = new Collection(this, { name: 'notes', endpoint: '/notes', field: 'notes', keyOf: (n) => n.id });
  }

  get signedIn() { return !!this.user; }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  setSync(state) {
    this.syncState = state;
    this.emit('sync', { state });
  }

  // ----- marks -----

  get(id) {
    return this.marks.items[id] || { visited: false, interested: false, note: '', changed_at: 0 };
  }

  set(id, patch) {
    if (!this.user) return false;
    this.marks.put(id, { ...this.get(id), ...patch });
    this.emit('change', { collection: 'marks', id });
    return true;
  }

  counts(ids) {
    let visited = 0, interested = 0, notes = 0;
    for (const id of ids) {
      const m = this.marks.items[id];
      if (!m) continue;
      if (m.visited) visited++;
      if (m.interested) interested++;
      if ((m.note || '').trim()) notes++;
    }
    return { visited, interested, notes };
  }

  // ----- an exhibitor's notes about visitors to their own booth -----

  notesFor(startup) {
    return Object.entries(this.boothNotes.items)
      .filter(([, n]) => n.startup === startup && !n.deleted)
      .map(([id, n]) => ({ id, ...n }))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  addBoothNote(startup, { person, contact, note }) {
    if (!this.user) return null;
    const id = newId();
    this.boothNotes.put(id, { id, startup, person, contact, note, created_at: Date.now(), deleted: false });
    this.emit('change', { collection: 'booth-notes', id });
    return id;
  }

  deleteBoothNote(id) {
    const n = this.boothNotes.items[id];
    if (!n || !this.user) return;
    this.boothNotes.put(id, { ...n, deleted: true });
    this.emit('change', { collection: 'booth-notes', id });
  }

  // ----- general notes (not tied to a startup) -----

  generalNotes() {
    return Object.entries(this.notes.items)
      .filter(([, n]) => !n.deleted && (n.text || '').trim())
      .map(([id, n]) => ({ id, ...n }))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  addNote(text) {
    if (!this.user || !text.trim()) return null;
    const id = newId();
    this.notes.put(id, { id, text, created_at: Date.now(), deleted: false });
    this.emit('change', { collection: 'notes', id });
    return id;
  }

  updateNote(id, text) {
    const n = this.notes.items[id];
    if (!n || !this.user) return;
    this.notes.put(id, { ...n, text });
    this.emit('change', { collection: 'notes', id });
  }

  deleteNote(id) {
    const n = this.notes.items[id];
    if (!n || !this.user) return;
    this.notes.put(id, { ...n, deleted: true });
    this.emit('change', { collection: 'notes', id });
  }

  // ----- profile -----

  async updateProfile(patch) {
    if (!this.user) return;
    Object.assign(this.user, patch);
    this.emit('auth', { user: this.user });
    try {
      const body = { ...patch };
      if ('own_startup' in body) body.own_startup = body.own_startup || '';
      this.user = await api('PATCH', '/visitors/me', body);
      this.emit('auth', { user: this.user });
    } catch (e) {
      this.handleSyncError(e);
    }
  }

  // ----- session -----

  async init() {
    if (!this.backend) return;
    try {
      const me = await api('GET', '/visitors/me');
      await this.startSession(me);
    } catch (e) {
      this.user = null;
      if (e.status === 404) this.backend = false; // static copy without the backend
      else if (e.status !== 401 && e.status !== 403) this.setSync('offline');
      this.emit('auth', { user: null });
    }
  }

  async startSession(me) {
    this.user = me;
    this.marks.load();
    this.boothNotes.load();
    this.notes.load();
    // Marks made on this device before signing in move into the account.
    const legacy = readJSON(LEGACY_KEY);
    if (legacy) {
      for (const [id, m] of Object.entries(legacy)) {
        const cur = this.marks.items[id];
        if (!cur || (m.changed_at || 0) > (cur.changed_at || 0)) {
          this.marks.items[id] = m;
          this.marks.dirty.add(id);
        }
      }
      this.marks.save();
      removeKey(LEGACY_KEY);
    }
    this.emit('auth', { user: this.user });
    this.emit('change', { collection: null });
    await Promise.all([this.marks.push(true), this.boothNotes.push(true), this.notes.push(true)]);
  }

  handleSyncError(e, retry) {
    if (e.status === 401 || e.status === 403) {
      // Session ended elsewhere: forget this account's data on the device.
      this.marks.clear(true);
      this.boothNotes.clear(true);
      this.notes.clear(true);
      this.user = null;
      this.emit('auth', { user: null, expired: true });
      this.emit('change', { collection: null });
      this.setSync('idle');
    } else {
      this.setSync('error');
      if (retry) setTimeout(retry, 15000);
    }
  }

  async requestCode(email) {
    await api('POST', '/visitors', { email });
    await api('POST', '/_auth/code/begin', { email });
  }

  async verifyCode(email, code) {
    await api('POST', '/_auth/code/verify', { email, code });
    const me = await api('GET', '/visitors/me');
    await this.startSession(me);
    return me;
  }

  // Permanently delete the account and everything stored for it, on the server and on this device.
  async deleteAccount() {
    if (!this.user) return;
    await api('DELETE', '/visitors/me?confirm=delete-my-account');
    this.marks.clear(true);
    this.boothNotes.clear(true);
    this.notes.clear(true);
    this.user = null;
    this.emit('auth', { user: null });
    this.emit('change', { collection: null });
    this.setSync('idle');
  }

  async signOut() {
    try {
      await Promise.all([this.marks.push(), this.boothNotes.push(), this.notes.push()]);
      await api('DELETE', '/sessions/current');
    } catch {
      /* the session may already be gone */
    }
    this.marks.clear(true);
    this.boothNotes.clear(true);
    this.notes.clear(true);
    this.user = null;
    this.emit('auth', { user: null });
    this.emit('change', { collection: null });
    this.setSync('idle');
  }
}
