import { FloorScene } from './scene.js';
import { MarkStore } from './store.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ICON_CHECK = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 2.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2L10 14.3l-4.6 2.5.9-5.2L2.5 8l5.2-.7z" fill="currentColor"/></svg>';
const LANGROVE_ID = 'langrove';
const BROWSE_KEY = 'sn26.browse';

const storageGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const storageSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

// ---------- data ----------

const [venue, startups] = await Promise.all([
  fetch('data/venue.json').then((r) => r.json()),
  fetch('data/startups.json').then((r) => r.json()),
]);

const byId = new Map(startups.map((s) => [s.id, s]));
const byBooth = new Map();
for (const s of startups) for (const b of s.booths) byBooth.set(b, s);
const mapBooths = new Set(venue.booths.map((b) => b.id));
const store = new MarkStore();

function boothLabel(booths) {
  const nums = booths.map(Number).sort((a, b) => a - b);
  const runs = [];
  for (const n of nums) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  const pad = (n) => String(n).padStart(3, '0');
  return runs.map(([a, b]) => (a === b ? pad(a) : `${pad(a)}–${pad(b)}`)).join(', ');
}

const ownStartup = () => (store.user && store.user.own_startup) || null;

// ---------- state ----------

const ui = {
  selected: null,
  spotlight: null, // a booth highlighted without opening its card (first-login welcome)
  filter: 'all',
  query: '',
  sort: 'name',
};

// If WebGL is unavailable the list, details and marks still work; only the 3D view is replaced.
function createScene() {
  try {
    return new FloorScene($('map'), venue);
  } catch (err) {
    console.error(err);
    $('map').innerHTML = '<div class="map-error">The 3D floor plan needs WebGL, which this browser has turned off. The list, details and your marks still work.</div>';
    document.querySelector('.map-tools').hidden = true;
    const noop = () => {};
    return Object.assign(new EventTarget(), {
      setBoothState: noop, select: noop, focus: noop, setTopView: noop, zoomBy: noop, resetView: noop, setInsetLeft: noop,
      screenPoint: () => null, onFrame: null,
    });
  }
}
const scene = createScene();
$('totalCount').textContent = startups.length;

function matches(s) {
  const m = store.get(s.id);
  if (ui.filter === 'star' && !m.interested) return false;
  if (ui.filter === 'visited' && !m.visited) return false;
  if (ui.filter === 'todo' && m.visited) return false;
  if (ui.filter === 'notes' && !(m.note || '').trim()) return false;
  const q = ui.query;
  if (!q) return true;
  if (/^\d{1,3}$/.test(q)) {
    const n = Number(q);
    if (s.booths.some((b) => Number(b) === n || b.includes(q))) return true;
  }
  return fold(`${s.name} ${s.category || ''} ${s.description || ''} ${m.note || ''}`).includes(q);
}

function filtering() {
  return ui.filter !== 'all' || ui.query !== '';
}

function refreshBooths() {
  const active = filtering();
  for (const s of startups) {
    const m = store.get(s.id);
    const dim = active && !matches(s);
    for (const b of s.booths) {
      if (mapBooths.has(b)) scene.setBoothState(b, { visited: m.visited, interested: m.interested, dim });
    }
  }
}

function refreshProgress() {
  const signedIn = store.signedIn;
  $('progressText').hidden = !signedIn;
  $('progressSignedOut').hidden = signedIn || !store.backend;
  const c = store.counts(startups.map((s) => s.id));
  $('visitedCount').textContent = c.visited;
  $('starCount').textContent = c.interested;
  $('progressFill').style.width = `${(c.visited / startups.length) * 100}%`;
}

// ---------- sign-in prompts ----------

// Personal features need an account so that notes stay private to their author.
function requireSignIn(reason) {
  if (store.signedIn) return true;
  openAuth(reason);
  return false;
}

// ---------- list ----------

function sorted(list) {
  const out = [...list];
  if (ui.sort === 'booth') out.sort((a, b) => Number(a.booths[0]) - Number(b.booths[0]));
  else {
    out.sort((a, b) => {
      const sa = a.status === 'surprise', sb = b.status === 'surprise';
      if (sa !== sb) return sa ? 1 : -1;
      return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || Number(a.booths[0]) - Number(b.booths[0]);
    });
  }
  return out;
}

function renderList() {
  const items = sorted(startups.filter(matches));
  $('resultCount').textContent = filtering() ? `${items.length} of ${startups.length} exhibitors` : `${startups.length} exhibitors`;
  const rows = [];
  const own = byId.get(ownStartup());
  if (own && !filtering()) {
    const n = store.notesFor(own.id).length;
    rows.push(`<li class="item mine" data-id="${esc(own.id)}" ${ui.selected === own.id ? 'aria-current="true"' : ''}>
      <button type="button" class="item-main" data-act="open" aria-label="Your booth, ${esc(own.name)}">
        <span class="num">${esc(own.booths[0])}</span>
        <span class="txt"><span class="name">Your booth · ${esc(own.name)}</span><span class="sub">${n} visitor note${n === 1 ? '' : 's'}</span></span>
      </button>
    </li>`);
  }
  if (!items.length) {
    rows.push(`<li class="empty">${ui.filter === 'all' ? 'No exhibitor matches your search.' : 'Nothing here yet. Mark booths from the map or the list.'}</li>`);
  }
  for (const s of items) {
    const m = store.get(s.id);
    const cls = ['item', m.visited ? 'is-visited' : '', m.interested ? 'is-star' : ''].join(' ');
    const sub = [s.category, `Booth ${boothLabel(s.booths)}`, (m.note || '').trim() ? 'Has note' : ''].filter(Boolean).join(' · ');
    const num = s.booths.length > 1 ? `${s.booths[0]}+` : s.booths[0];
    rows.push(`<li class="${cls}" data-id="${esc(s.id)}" ${ui.selected === s.id ? 'aria-current="true"' : ''}>
      <button type="button" class="item-main" data-act="open" aria-label="${esc(s.name)}, booth ${esc(boothLabel(s.booths))}">
        <span class="num">${esc(num)}</span>
        <span class="txt"><span class="name">${esc(s.name)}</span><span class="sub">${esc(sub)}</span></span>
      </button>
      <span class="marks">
        <button type="button" class="mark-btn v ${m.visited ? 'on' : ''}" data-act="visited" aria-pressed="${m.visited}" aria-label="Visited ${esc(s.name)}" title="Visited">${ICON_CHECK}</button>
        <button type="button" class="mark-btn s ${m.interested ? 'on' : ''}" data-act="star" aria-pressed="${m.interested}" aria-label="Interested in ${esc(s.name)}" title="Interested">${ICON_STAR}</button>
      </span>
    </li>`);
  }
  $('list').innerHTML = rows.join('');
}

$('list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  const li = e.target.closest('li[data-id]');
  if (!btn || !li) return;
  const id = li.dataset.id;
  const act = btn.dataset.act;
  if (act === 'open') { select(id, { fly: true }); return; }
  if (!requireSignIn('mark')) return;
  const m = store.get(id);
  if (act === 'visited') store.set(id, { visited: !m.visited });
  else if (act === 'star') store.set(id, { interested: !m.interested });
});

// Scroll only the list (scrollIntoView would also scroll the page on phones).
function scrollListTo(id) {
  const list = $('list');
  const li = list.querySelector(`li[data-id="${CSS.escape(id)}"]:not(.mine)`);
  if (!li) return;
  const top = li.offsetTop - list.offsetTop;
  if (top < list.scrollTop || top + li.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3), behavior: 'smooth' });
  }
}

// ---------- detail ----------

const detail = $('detail');
let noteTimer = null;
let noteFor = null;

function flushNote() {
  clearTimeout(noteTimer);
  if (noteFor && store.signedIn && store.get(noteFor).note !== $('noteInput').value) {
    store.set(noteFor, { note: $('noteInput').value });
  }
}

const timeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function renderBoothNotes(s) {
  const notes = store.notesFor(s.id);
  $('boothNotesCount').textContent = notes.length ? `(${notes.length})` : '';
  $('boothNoteList').innerHTML = notes.length
    ? notes.map((n) => `<li data-note="${esc(n.id)}">
        <div class="bn-head"><strong>${esc(n.person || 'Visitor')}</strong>${n.contact ? ` · <span>${esc(n.contact)}</span>` : ''}<time>${esc(timeFmt.format(new Date(n.created_at || Date.now())))}</time></div>
        ${n.note ? `<p>${esc(n.note)}</p>` : ''}
        <button type="button" class="bn-del" data-del="${esc(n.id)}" aria-label="Delete note about ${esc(n.person || 'visitor')}">×</button>
      </li>`).join('')
    : '<li class="bn-empty">No visitor notes yet.</li>';
}

function renderDetail() {
  const s = byId.get(ui.selected);
  if (!s) { detail.hidden = true; updateInset(); return; }
  const m = store.get(s.id);
  const isOwn = ownStartup() === s.id;
  const onMap = s.booths.some((b) => mapBooths.has(b));
  const chips = [`<span class="tag booth">Booth ${esc(boothLabel(s.booths))}</span>`];
  if (isOwn) chips.push('<span class="tag own">Your booth</span>');
  if (s.category) chips.push(`<span class="tag">${esc(s.category)}</span>`);
  if (s.status === 'partial' || s.status === 'pending') chips.push('<span class="tag warn">Details unverified</span>');
  $('detailChips').innerHTML = chips.join('');
  $('detailName').textContent = s.name;

  const desc = $('detailDesc');
  if (s.status === 'surprise') {
    desc.textContent = 'A surprise startup that is revealed at the event. Drop by and find out who it is.';
    desc.className = 'detail-desc muted';
  } else if (s.description) {
    desc.textContent = s.description;
    desc.className = 'detail-desc';
  } else {
    desc.textContent = 'We could not verify details about this exhibitor online yet. Stop by the booth or search the web.';
    desc.className = 'detail-desc muted';
  }
  if (!onMap) desc.textContent += ' This booth number is not marked on the official floor plan; ask at the info desk.';

  const links = [];
  if (s.website) {
    const label = s.websiteKind === 'profile' ? 'View profile' : 'Visit website';
    links.push(`<a href="${esc(s.website)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`);
  }
  if (s.status !== 'surprise' && (s.status !== 'verified' || !s.website || s.websiteKind === 'profile')) {
    const q = encodeURIComponent(`${s.name} Startup Nights 2026`);
    links.push(`<a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener noreferrer">Search the web ↗</a>`);
  }
  $('detailLinks').innerHTML = links.join('');

  // Visitors: visited / interested / private note. Exhibitors on their own booth: visitor notes.
  const signedIn = store.signedIn;
  $('personalSection').hidden = isOwn || !store.backend;
  $('boothNotes').hidden = !isOwn;
  $('detailActions').hidden = !signedIn;
  $('notesBlock').hidden = !signedIn;
  $('signinPrompt').hidden = signedIn;
  const v = $('toggleVisited'), st = $('toggleStar');
  v.setAttribute('aria-pressed', m.visited);
  v.querySelector('span').textContent = m.visited ? 'Visited' : 'Mark visited';
  st.setAttribute('aria-pressed', m.interested);
  st.querySelector('span').textContent = m.interested ? 'Starred' : 'Interested';
  if (isOwn) renderBoothNotes(s);

  if (noteFor !== s.id) {
    $('noteInput').value = m.note || '';
    noteFor = s.id;
  } else if (document.activeElement !== $('noteInput')) {
    $('noteInput').value = m.note || '';
  }

  const ownBtn = $('ownBoothBtn');
  ownBtn.hidden = s.status === 'surprise' || !store.backend;
  ownBtn.textContent = isOwn ? 'Not your booth? Remove it from your account' : 'Exhibiting at this booth? Keep notes on your visitors';
  detail.hidden = false;
  updateInset();
}

// On wide screens the card floats over the map's lower left; shift the view so the booth stays visible.
function updateInset() {
  const overMap = !detail.hidden && detail.parentElement?.classList.contains('map-pane');
  scene.setInsetLeft(overMap ? detail.offsetWidth + 14 : 0);
}

function select(id, { fly = false, scroll = false } = {}) {
  flushNote();
  const s = id ? byId.get(id) : null;
  ui.selected = s ? s.id : null;
  if (ui.spotlight && ui.spotlight !== ui.selected) hideWelcome();
  scene.select(s ? s.booths : null);
  if (s && fly) scene.focus(s.booths);
  renderDetail();
  for (const li of $('list').querySelectorAll('li[data-id]')) {
    if (li.dataset.id === ui.selected) li.setAttribute('aria-current', 'true');
    else li.removeAttribute('aria-current');
  }
  if (s && scroll) scrollListTo(s.id);
  const hash = s ? `#${s.id}` : ' ';
  history.replaceState(null, '', hash === ' ' ? location.pathname + location.search : hash);
}

$('detailClose').addEventListener('click', () => select(null));
$('toggleVisited').addEventListener('click', () => {
  if (!requireSignIn('mark')) return;
  const m = store.get(ui.selected);
  store.set(ui.selected, { visited: !m.visited });
});
$('toggleStar').addEventListener('click', () => {
  if (!requireSignIn('mark')) return;
  const m = store.get(ui.selected);
  store.set(ui.selected, { interested: !m.interested });
});
$('noteInput').addEventListener('input', () => {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(flushNote, 600);
});
$('noteInput').addEventListener('blur', flushNote);
$('signinFromDetail').addEventListener('click', () => openAuth('mark'));

$('ownBoothBtn').addEventListener('click', async () => {
  if (!requireSignIn('booth')) return;
  const s = byId.get(ui.selected);
  if (!s) return;
  const isOwn = ownStartup() === s.id;
  await store.updateProfile({ own_startup: isOwn ? null : s.id });
  renderList();
  renderDetail();
  if (!isOwn) $('bnPerson').focus();
});

$('boothNoteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const s = byId.get(ui.selected);
  if (!s || !requireSignIn('booth')) return;
  const person = $('bnPerson').value.trim();
  const contact = $('bnContact').value.trim();
  const note = $('bnNote').value.trim();
  if (!person && !contact && !note) { $('bnPerson').focus(); return; }
  store.addBoothNote(s.id, { person, contact, note });
  $('bnPerson').value = '';
  $('bnContact').value = '';
  $('bnNote').value = '';
  $('bnPerson').focus();
});

$('boothNoteList').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (!del) return;
  if (confirm('Delete this visitor note?')) store.deleteBoothNote(del.dataset.del);
});

$('bnExport').addEventListener('click', () => {
  const s = byId.get(ui.selected);
  if (!s) return;
  const notes = store.notesFor(s.id);
  if (!notes.length) return;
  downloadCsv(`${s.id}-visitor-notes.csv`, ['Time', 'Visitor', 'Contact', 'Note'],
    notes.map((n) => [new Date(n.created_at).toLocaleString(), n.person, n.contact, n.note]));
});

// The detail card floats over the map on wide screens and sits above the list on phones.
const narrow = window.matchMedia('(max-width: 860px), (max-height: 560px) and (orientation: landscape)');
function placeDetail() {
  if (narrow.matches) document.querySelector('.sidebar').prepend(detail);
  else document.querySelector('.map-pane').append(detail);
}
narrow.addEventListener('change', () => { placeDetail(); updateInset(); });
placeDetail();

// ---------- map interaction ----------

const tooltip = $('tooltip');
scene.addEventListener('hover', (e) => {
  const { boothId, room, x, y } = e.detail;
  if (boothId) {
    const s = byBooth.get(boothId);
    tooltip.innerHTML = `<b>${esc(s ? s.name : 'Booth')}</b><span>Booth ${esc(boothId)}${s?.category ? ` · ${esc(s.category)}` : ''}</span>`;
  } else if (room) {
    tooltip.innerHTML = `<b>${esc(room)}</b>`;
  } else {
    tooltip.hidden = true;
    return;
  }
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
  tooltip.hidden = false;
});

scene.addEventListener('pick', (e) => {
  const s = e.detail.boothId ? byBooth.get(e.detail.boothId) : null;
  if (s) select(s.id, { scroll: true });
  else select(null);
});

const nameTag = $('nameTag');
scene.onFrame = () => {
  const s = byId.get(ui.selected || ui.spotlight);
  const p = s ? scene.screenPoint(s.booths) : null;
  if (!p) { nameTag.hidden = true; return; }
  nameTag.textContent = s.name;
  nameTag.style.left = `${p.x}px`;
  nameTag.style.top = `${p.y}px`;
  nameTag.hidden = false;
};

function setView(top) {
  $('view3d').classList.toggle('active', !top);
  $('view2d').classList.toggle('active', top);
  $('view3d').setAttribute('aria-pressed', !top);
  $('view2d').setAttribute('aria-pressed', top);
  scene.setTopView(top);
}
$('view3d').addEventListener('click', () => setView(false));
$('view2d').addEventListener('click', () => setView(true));
$('zoomIn').addEventListener('click', () => scene.zoomBy(0.7));
$('zoomOut').addEventListener('click', () => scene.zoomBy(1.4));
$('resetView').addEventListener('click', () => scene.resetView(true));
$('madeBy').addEventListener('click', () => select(LANGROVE_ID, { fly: true, scroll: true }));

// ---------- first-login welcome: highlight the Langrove booth with a short note ----------

function showWelcome() {
  const s = byId.get(LANGROVE_ID);
  if (!s) return;
  select(null);
  ui.spotlight = s.id;
  scene.select(s.booths);
  scene.focus(s.booths);
  $('welcome').hidden = false;
  $('welcomeClose').focus({ preventScroll: true });
}

function hideWelcome() {
  if (!ui.spotlight) return;
  ui.spotlight = null;
  $('welcome').hidden = true;
  if (!ui.selected) scene.select(null);
}

$('welcomeClose').addEventListener('click', hideWelcome);

// ---------- search, filters, sort ----------

let searchTimer = null;
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    ui.query = fold($('search').value.trim());
    renderList();
    refreshBooths();
  }, 120);
});
$('search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const first = $('list').querySelector('li[data-id]:not(.mine)');
  if (first) select(first.dataset.id, { fly: true });
});

function setFilter(value) {
  ui.filter = value;
  for (const c of document.querySelectorAll('.chip[data-filter]')) {
    c.classList.toggle('active', c.dataset.filter === value);
    c.setAttribute('aria-pressed', c.dataset.filter === value);
  }
  renderList();
  refreshBooths();
}
for (const chip of document.querySelectorAll('.chip[data-filter]')) {
  chip.addEventListener('click', () => {
    if (chip.dataset.filter !== 'all' && !requireSignIn('mark')) return;
    setFilter(chip.dataset.filter);
  });
}
$('sort').addEventListener('change', () => {
  ui.sort = $('sort').value;
  renderList();
});

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape' && !$('authModal').open) { hideWelcome(); select(null); }
  if (e.key === '/' && !typing) { e.preventDefault(); $('search').focus(); }
});

// ---------- marks ----------

store.addEventListener('change', () => {
  refreshBooths();
  refreshProgress();
  renderList();
  if (ui.selected) renderDetail();
});

// ---------- export ----------

function downloadCsv(filename, header, rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('exportBtn').addEventListener('click', () => {
  if (!requireSignIn('mark')) return;
  const rows = startups
    .map((s) => ({ s, m: store.get(s.id) }))
    .filter(({ m }) => m.visited || m.interested || (m.note || '').trim());
  if (!rows.length) {
    $('exportBtn').textContent = 'Nothing marked yet';
    setTimeout(() => { $('exportBtn').textContent = 'Export my notes'; }, 1800);
    return;
  }
  downloadCsv('startup-nights-2026-my-booths.csv', ['Startup', 'Booth', 'Visited', 'Interested', 'Note', 'Website', 'Category'],
    rows.map(({ s, m }) => [s.name, boothLabel(s.booths), m.visited ? 'yes' : '', m.interested ? 'yes' : '', m.note || '', s.website || '', s.category || '']));
});

// ---------- sign-in ----------

const modal = $('authModal');
let authEmail = '';
let authReason = null;

const REASONS = {
  intro: 'Sign in with your email to mark booths you visit and keep private notes. Only you can see them, on any device.',
  mark: 'Sign in to mark booths and keep notes. Your notes are private: only you can see them.',
  booth: 'Sign in to keep private notes about the people who visit your booth.',
};

function authStep(step) {
  $('stepEmail').hidden = step !== 'email';
  $('stepCode').hidden = step !== 'code';
  $('stepSignedIn').hidden = step !== 'done';
  $('stepDelete').hidden = step !== 'delete';
  $('authIntro').hidden = step === 'done' || step === 'delete';
  $('authBack').hidden = step !== 'code';
  $('authCancelDelete').hidden = step !== 'delete';
  $('authBrowse').hidden = !(step === 'email' && authReason === 'intro');
  $('authTitle').textContent = step === 'done' ? 'Your account'
    : step === 'delete' ? 'Delete your account?'
    : authReason === 'intro' ? 'Startup Nights 2026 booth map' : 'Sign in';
  $('authSubmit').textContent = { email: 'Send code', code: 'Sign in', done: 'Sign out', delete: 'Delete account' }[step];
  $('authSubmit').className = step === 'done' ? 'btn' : step === 'delete' ? 'btn danger' : 'btn primary';
  $('authError').textContent = '';
  modal.dataset.step = step;
}

function openAuth(reason = 'mark') {
  if (!store.backend) return;
  authReason = reason;
  $('authIntro').textContent = REASONS[reason] || REASONS.mark;
  if (store.user) {
    $('authWho').textContent = store.user.email;
    const own = byId.get(ownStartup());
    $('authOwnBooth').textContent = own ? `Your booth: ${own.name} (${boothLabel(own.booths)}).` : '';
    authStep('done');
  } else authStep('email');
  if (!modal.open) modal.showModal();
  setTimeout(() => (store.user ? $('authSubmit') : $('authEmail')).focus(), 30);
}

function closeAuth() {
  if (authReason === 'intro') storageSet(BROWSE_KEY, '1');
  if (modal.open) modal.close();
}

function renderAccount() {
  const u = store.user;
  $('accountBtn').hidden = !store.backend;
  document.body.classList.toggle('no-backend', !store.backend);
  // Narrow screens show "Account" instead of a long email, so the header keeps one row.
  $('accountBtn').innerHTML = u
    ? `<span class="btn-long">${esc(u.email)}</span><span class="btn-short">Account</span><svg class="btn-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="7" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.8 17c.9-3.1 3.3-4.8 6.2-4.8s5.3 1.7 6.2 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
    : 'Sign in';
  $('accountBtn').setAttribute('aria-label', u ? `Account: ${u.email}` : 'Sign in');
  $('accountBtn').title = u ? 'Your account' : 'Sign in to mark booths and keep private notes';
  $('footNote').textContent = u ? 'Private to your account' : store.backend ? 'Sign in to save marks and notes' : 'Saved on this device';
  refreshProgress();
}

$('accountBtn').addEventListener('click', () => openAuth(store.user ? 'account' : 'mark'));
$('authClose').addEventListener('click', closeAuth);
$('authBrowse').addEventListener('click', closeAuth);
modal.addEventListener('cancel', () => { if (authReason === 'intro') storageSet(BROWSE_KEY, '1'); });
$('authBack').addEventListener('click', () => { authStep('email'); $('authEmail').focus(); });
$('authDeleteStart').addEventListener('click', () => { authStep('delete'); $('authCancelDelete').focus(); });
$('authCancelDelete').addEventListener('click', () => { authStep('done'); $('authSubmit').focus(); });

let toastTimer = null;
function showToast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const step = modal.dataset.step;
  const btn = $('authSubmit');
  btn.disabled = true;
  $('authError').textContent = '';
  try {
    if (step === 'email') {
      authEmail = $('authEmail').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) throw new Error('Please enter a valid email address.');
      await store.requestCode(authEmail);
      $('authEmailEcho').textContent = authEmail;
      $('authCode').value = '';
      authStep('code');
      $('authCode').focus();
    } else if (step === 'code') {
      const code = $('authCode').value.replace(/\D/g, '');
      if (code.length < 4) throw new Error('Enter the code from the email.');
      let me;
      try {
        me = await store.verifyCode(authEmail, code);
      } catch (err) {
        if (err.status === 401) throw new Error('That code did not work. Check the email or request a new one.');
        throw err;
      }
      storageSet(BROWSE_KEY, '1');
      modal.close();
      if (!me.welcomed) {
        showWelcome();
        store.updateProfile({ welcomed: true });
      }
    } else if (step === 'delete') {
      await store.deleteAccount();
      modal.close();
      select(null);
      showToast('Your account and all your notes have been deleted.');
    } else {
      await store.signOut();
      modal.close();
    }
  } catch (err) {
    $('authError').textContent = err.message || 'Something went wrong. Please try again.';
  } finally {
    btn.disabled = false;
  }
});

store.addEventListener('auth', (e) => {
  renderAccount();
  renderList();
  if (ui.selected) renderDetail();
  if (e.detail?.expired) openAuth('mark');
});
store.addEventListener('sync', (e) => {
  const el = $('syncStatus');
  // Saving happens quietly; only a problem is worth showing.
  const map = { error: ['Offline, will retry', 'err'], offline: ['Offline', 'err'] };
  const v = map[e.detail.state];
  el.hidden = !v;
  if (v) { el.textContent = v[0]; el.className = `sync ${v[1]}`; }
});

// ---------- share: QR code and link to the live site ----------

const LIVE_URL = 'https://startup-nights-2026.ttm.devcore.build';
const SHARE_TITLE = 'Startup Nights 2026 booth map';
const SHARE_TEXT = 'Find every startup at Startup Nights 2026 on the interactive 3D booth map';
const shareModal = $('shareModal');

$('shareBtn').addEventListener('click', () => {
  const message = `${SHARE_TEXT}: ${LIVE_URL}`;
  $('shareUrl').value = LIVE_URL;
  $('shareWhatsApp').href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  $('shareSms').href = `sms:?&body=${encodeURIComponent(message)}`;
  $('shareEmail').href = `mailto:?subject=${encodeURIComponent(SHARE_TITLE)}&body=${encodeURIComponent(message)}`;
  $('shareMore').hidden = typeof navigator.share !== 'function';
  $('copyLink').textContent = 'Copy link';
  shareModal.showModal();
  $('copyLink').focus();
});
$('shareClose').addEventListener('click', () => shareModal.close());
shareModal.addEventListener('click', (e) => { if (e.target === shareModal) shareModal.close(); });

$('copyLink').addEventListener('click', async () => {
  let ok = false;
  try {
    await navigator.clipboard.writeText(LIVE_URL);
    ok = true;
  } catch {
    const input = $('shareUrl');
    input.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
  }
  $('copyLink').textContent = ok ? 'Copied!' : 'Select and copy';
  setTimeout(() => { $('copyLink').textContent = 'Copy link'; }, 2000);
});

$('shareMore').addEventListener('click', async () => {
  try {
    await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: LIVE_URL });
  } catch {
    /* the person closed the share sheet */
  }
});

// ---------- touch gesture hint (once per device) ----------

if (window.matchMedia('(pointer: coarse)').matches && $('gestureHint')) {
  if (storageGet('sn26.hint') !== '1') {
    const hint = $('gestureHint');
    hint.hidden = false;
    const dismiss = () => {
      hint.classList.add('gone');
      setTimeout(() => hint.remove(), 450);
      storageSet('sn26.hint', '1');
    };
    $('map').addEventListener('pointerdown', dismiss, { once: true });
    setTimeout(dismiss, 7000);
  }
}

// ---------- start ----------

refreshBooths();
renderList();
renderAccount();
requestAnimationFrame(() => {
  const el = $('loading');
  el.classList.add('gone');
  setTimeout(() => el.remove(), 400);
});

const fromHash = decodeURIComponent(location.hash.slice(1));
if (fromHash) {
  const s = byId.get(fromHash) || byBooth.get(fromHash.padStart(3, '0'));
  if (s) select(s.id, { fly: true, scroll: true });
}

await store.init();
renderAccount();
// First visit without an account: offer sign-in once, with the option to just browse.
if (store.backend && !store.signedIn && storageGet(BROWSE_KEY) !== '1') openAuth('intro');
