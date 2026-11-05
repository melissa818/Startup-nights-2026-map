// Per-visitor booth marks: visited, interested (starred) and a note per startup.
// Always saved on this device; synced to the Langrove backend when the visitor signs in.

const LOCAL_KEY = 'sn26.marks.v1';
const SYNC_DELAY_MS = 1200;

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocal(marks) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(marks));
  } catch {
    /* private mode or storage full: marks still live for this visit */
  }
}

const isEmpty = (m) => !m || (!m.visited && !m.interested && !(m.note || '').trim());

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const err = new Error((data && (data.detail || data.error)) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export class MarkStore extends EventTarget {
  constructor() {
    super();
    this.marks = readLocal();
    this.user = null;          // { id, email } when signed in
    this.syncState = 'local';  // local | syncing | synced | error | offline
    this.dirty = new Set();
    this.timer = null;
    // The backend lives on the same origin as the page; a file:// copy works locally only.
    this.backend = location.protocol.startsWith('http');
  }

  get(id) {
    return this.marks[id] || { visited: false, interested: false, note: '', changed_at: 0 };
  }

  set(id, patch) {
    const next = { ...this.get(id), ...patch, changed_at: Date.now() };
    this.marks[id] = next;
    writeLocal(this.marks);
    this.emit('change', { id });
    if (this.user) {
      this.dirty.add(id);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.push(), SYNC_DELAY_MS);
    }
  }

  counts(ids) {
    let visited = 0;
    let interested = 0;
    let notes = 0;
    for (const id of ids) {
      const m = this.marks[id];
      if (!m) continue;
      if (m.visited) visited++;
      if (m.interested) interested++;
      if ((m.note || '').trim()) notes++;
    }
    return { visited, interested, notes };
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setSync(state) {
    this.syncState = state;
    this.emit('sync', { state });
  }

  // Merge server marks into local ones; the newest edit of each startup wins.
  absorb(serverMarks) {
    let changed = false;
    for (const s of serverMarks || []) {
      const local = this.marks[s.startup];
      if (!local || (s.changed_at || 0) > (local.changed_at || 0)) {
        this.marks[s.startup] = {
          visited: !!s.visited,
          interested: !!s.interested,
          note: s.note || '',
          changed_at: s.changed_at || 0,
        };
        changed = true;
      }
    }
    if (changed) {
      writeLocal(this.marks);
      this.emit('change', { id: null });
    }
  }

  async init() {
    if (!this.backend) return;
    try {
      this.user = await api('GET', '/visitors/me');
      this.emit('auth', { user: this.user });
      await this.fullSync();
    } catch (e) {
      this.user = null;
      if (e.status === 404) this.backend = false; // served without the backend (e.g. a plain static host)
      else if (e.status !== 401 && e.status !== 403) this.setSync('offline');
    }
  }

  // Send every local mark once (the server keeps whichever edit is newer), then take the merged list.
  async fullSync() {
    if (!this.user) return;
    this.setSync('syncing');
    try {
      const payload = {};
      for (const [id, m] of Object.entries(this.marks)) {
        if (!isEmpty(m) || m.changed_at) payload[id] = m;
      }
      const res = await api('PUT', '/marks', { marks: payload });
      this.dirty.clear();
      this.absorb(res.marks);
      this.setSync('synced');
    } catch (e) {
      this.handleSyncError(e);
    }
  }

  async push() {
    if (!this.user || this.dirty.size === 0) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    const payload = {};
    for (const id of ids) payload[id] = this.get(id);
    this.setSync('syncing');
    try {
      const res = await api('PUT', '/marks', { marks: payload });
      this.absorb(res.marks);
      this.setSync('synced');
    } catch (e) {
      ids.forEach((id) => this.dirty.add(id));
      this.handleSyncError(e);
    }
  }

  handleSyncError(e) {
    if (e.status === 401 || e.status === 403) {
      this.user = null;
      this.emit('auth', { user: null });
      this.setSync('local');
    } else {
      this.setSync('error');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.push(), 15000);
    }
  }

  // Sign-in with a one-time code mailed by the platform.
  async requestCode(email) {
    await api('POST', '/visitors', { email });
    await api('POST', '/_auth/code/begin', { email });
  }

  async verifyCode(email, code) {
    await api('POST', '/_auth/code/verify', { email, code });
    this.user = await api('GET', '/visitors/me');
    this.emit('auth', { user: this.user });
    await this.fullSync();
  }

  async signOut() {
    try {
      await this.push();
      await api('DELETE', '/sessions/current');
    } catch {
      /* the session may already be gone */
    }
    this.user = null;
    this.emit('auth', { user: null });
    this.setSync('local');
  }
}
