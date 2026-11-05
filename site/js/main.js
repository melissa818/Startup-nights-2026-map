import { FloorScene } from './scene.js';
import { MarkStore } from './store.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ICON_CHECK = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 2.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2L10 14.3l-4.6 2.5.9-5.2L2.5 8l5.2-.7z" fill="currentColor"/></svg>';

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

// ---------- state ----------

const ui = {
  selected: null,
  filter: 'all',
  query: '',
  sort: 'name',
};

const scene = new FloorScene($('map'), venue);
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
  const c = store.counts(startups.map((s) => s.id));
  $('visitedCount').textContent = c.visited;
  $('starCount').textContent = c.interested;
  $('progressFill').style.width = `${(c.visited / startups.length) * 100}%`;
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
  if (!items.length) {
    $('list').innerHTML = `<li class="empty">${ui.filter === 'all' ? 'No exhibitor matches your search.' : 'Nothing here yet. Mark booths from the map or the list.'}</li>`;
    return;
  }
  $('list').innerHTML = items.map((s) => {
    const m = store.get(s.id);
    const cls = ['item', m.visited ? 'is-visited' : '', m.interested ? 'is-star' : ''].join(' ');
    const sub = [s.category, `Booth ${boothLabel(s.booths)}`, (m.note || '').trim() ? 'Has note' : ''].filter(Boolean).join(' · ');
    const num = s.booths.length > 1 ? `${s.booths[0]}+` : s.booths[0];
    return `<li class="${cls}" data-id="${esc(s.id)}" ${ui.selected === s.id ? 'aria-current="true"' : ''}>
      <button type="button" class="item-main" data-act="open" aria-label="${esc(s.name)}, booth ${esc(boothLabel(s.booths))}">
        <span class="num">${esc(num)}</span>
        <span class="txt"><span class="name">${esc(s.name)}</span><span class="sub">${esc(sub)}</span></span>
      </button>
      <span class="marks">
        <button type="button" class="mark-btn v ${m.visited ? 'on' : ''}" data-act="visited" aria-pressed="${m.visited}" aria-label="Visited ${esc(s.name)}" title="Visited">${ICON_CHECK}</button>
        <button type="button" class="mark-btn s ${m.interested ? 'on' : ''}" data-act="star" aria-pressed="${m.interested}" aria-label="Interested in ${esc(s.name)}" title="Interested">${ICON_STAR}</button>
      </span>
    </li>`;
  }).join('');
}

$('list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  const li = e.target.closest('li[data-id]');
  if (!btn || !li) return;
  const id = li.dataset.id;
  const m = store.get(id);
  if (btn.dataset.act === 'visited') store.set(id, { visited: !m.visited });
  else if (btn.dataset.act === 'star') store.set(id, { interested: !m.interested });
  else select(id, { fly: true });
});

// Scroll only the list (scrollIntoView would also scroll the page on phones).
function scrollListTo(id) {
  const list = $('list');
  const li = list.querySelector(`li[data-id="${CSS.escape(id)}"]`);
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
  if (noteFor && store.get(noteFor).note !== $('noteInput').value) {
    store.set(noteFor, { note: $('noteInput').value });
    $('noteSaved').textContent = 'Saved';
  }
}

function renderDetail() {
  const s = byId.get(ui.selected);
  if (!s) { detail.hidden = true; return; }
  const m = store.get(s.id);
  const onMap = s.booths.some((b) => mapBooths.has(b));
  const chips = [`<span class="tag booth">Booth ${esc(boothLabel(s.booths))}</span>`];
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

  const v = $('toggleVisited'), st = $('toggleStar');
  v.setAttribute('aria-pressed', m.visited);
  v.querySelector('span').textContent = m.visited ? 'Visited' : 'Mark visited';
  st.setAttribute('aria-pressed', m.interested);
  st.querySelector('span').textContent = m.interested ? 'Starred' : 'Interested';

  if (noteFor !== s.id) {
    $('noteInput').value = m.note || '';
    $('noteSaved').textContent = '';
    noteFor = s.id;
  } else if (document.activeElement !== $('noteInput')) {
    $('noteInput').value = m.note || '';
  }
  detail.hidden = false;
}

function select(id, { fly = false, scroll = false } = {}) {
  flushNote();
  const s = id ? byId.get(id) : null;
  ui.selected = s ? s.id : null;
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
  const m = store.get(ui.selected);
  store.set(ui.selected, { visited: !m.visited });
});
$('toggleStar').addEventListener('click', () => {
  const m = store.get(ui.selected);
  store.set(ui.selected, { interested: !m.interested });
});
$('noteInput').addEventListener('input', () => {
  $('noteSaved').textContent = '';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(flushNote, 600);
});
$('noteInput').addEventListener('blur', flushNote);

// The detail card floats over the map on wide screens and sits above the list on phones.
const narrow = window.matchMedia('(max-width: 860px)');
function placeDetail() {
  if (narrow.matches) document.querySelector('.sidebar').prepend(detail);
  else document.querySelector('.map-pane').append(detail);
}
narrow.addEventListener('change', placeDetail);
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
  const s = byId.get(ui.selected);
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
  const first = $('list').querySelector('li[data-id]');
  if (first) select(first.dataset.id, { fly: true });
});

for (const chip of document.querySelectorAll('.chip[data-filter]')) {
  chip.addEventListener('click', () => {
    ui.filter = chip.dataset.filter;
    for (const c of document.querySelectorAll('.chip[data-filter]')) {
      c.classList.toggle('active', c === chip);
      c.setAttribute('aria-pressed', c === chip);
    }
    renderList();
    refreshBooths();
  });
}
$('sort').addEventListener('change', () => {
  ui.sort = $('sort').value;
  renderList();
});

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape' && !$('authModal').open) select(null);
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

$('exportBtn').addEventListener('click', () => {
  const rows = startups
    .map((s) => ({ s, m: store.get(s.id) }))
    .filter(({ m }) => m.visited || m.interested || (m.note || '').trim());
  if (!rows.length) {
    $('exportBtn').textContent = 'Nothing marked yet';
    setTimeout(() => { $('exportBtn').textContent = 'Export my notes'; }, 1800);
    return;
  }
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Startup', 'Booth', 'Visited', 'Interested', 'Note', 'Website', 'Category'].map(cell).join(',')];
  for (const { s, m } of rows) {
    lines.push([s.name, boothLabel(s.booths), m.visited ? 'yes' : '', m.interested ? 'yes' : '', m.note || '', s.website || '', s.category || ''].map(cell).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'startup-nights-2026-my-booths.csv';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- sign-in for sync ----------

const modal = $('authModal');
let authEmail = '';

function authStep(step) {
  $('stepEmail').hidden = step !== 'email';
  $('stepCode').hidden = step !== 'code';
  $('stepSignedIn').hidden = step !== 'done';
  $('authIntro').hidden = step === 'done';
  $('authBack').hidden = step !== 'code';
  $('authSubmit').textContent = step === 'email' ? 'Send code' : step === 'code' ? 'Sign in' : 'Sign out';
  $('authSubmit').className = step === 'done' ? 'btn' : 'btn primary';
  $('authError').textContent = '';
  modal.dataset.step = step;
}

function renderAccount() {
  const u = store.user;
  $('accountBtn').hidden = !store.backend;
  $('accountBtn').textContent = u ? u.email : 'Sync across devices';
  $('accountBtn').title = u ? 'Signed in: your marks sync across devices' : 'Sign in with your email to sync your marks';
  $('footSync').textContent = u ? ' and synced to your account' : '';
}

$('accountBtn').addEventListener('click', () => {
  if (store.user) {
    $('authWho').textContent = store.user.email;
    authStep('done');
  } else authStep('email');
  modal.showModal();
  setTimeout(() => (store.user ? $('authSubmit') : $('authEmail')).focus(), 30);
});
$('authClose').addEventListener('click', () => modal.close());
$('authBack').addEventListener('click', () => { authStep('email'); $('authEmail').focus(); });

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
      try {
        await store.verifyCode(authEmail, code);
      } catch (err) {
        if (err.status === 401) throw new Error('That code did not work. Check the email or request a new one.');
        throw err;
      }
      modal.close();
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

store.addEventListener('auth', renderAccount);
store.addEventListener('sync', (e) => {
  const el = $('syncStatus');
  const map = { syncing: ['Syncing…', 'busy'], synced: ['Synced', 'ok'], error: ['Sync paused, retrying', 'err'], offline: ['Offline: saved on device', 'err'] };
  const v = map[e.detail.state];
  el.hidden = !v;
  if (v) { el.textContent = v[0]; el.className = `sync ${v[1]}`; }
});

// ---------- start ----------

refreshBooths();
refreshProgress();
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

store.init().then(renderAccount);
