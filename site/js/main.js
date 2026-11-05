import { FloorScene } from './scene.js';
import { MarkStore } from './store.js';
import { initChat } from './chat.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ICON_CHECK = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 2.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2L10 14.3l-4.6 2.5.9-5.2L2.5 8l5.2-.7z" fill="currentColor"/></svg>';
const LANGROVE_ID = 'langrove';
const BROWSE_KEY = 'sn26.browse';

const storageGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const storageSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
let chat = null; // the live chat, started once the account is known

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

// ---------- places: rooms and areas people can search for ----------

const KINDS = {
  workshop: { label: 'Workshop', words: 'workshop workshops session sessions class', info: 'Workshop room. Check the event programme for session times.' },
  stage: { label: 'Stage', words: 'stage stages talk talks keynote pitch pitches panel', info: 'Stage for talks, panels and pitches. Check the event programme for the schedule.' },
  bar: { label: 'Bar', words: 'bar bars drink drinks beer cocktail', info: 'Bar with drinks.' },
  food: { label: 'Food & drinks', words: 'food eat snack snacks drink drinks lunch dinner', info: 'Food and drinks.' },
  lounge: { label: 'Lounge', words: 'lounge lounges', info: 'Lounge.' },
  service: { label: 'Facilities', words: 'facilities', info: '' },
  area: { label: 'Area', words: 'area', info: '' },
  entrance: { label: 'Entrance', words: 'entrance entry door way in', info: 'Main entrance to the hall.' },
  exit: { label: 'Safety', words: 'exit exits emergency fire safety', info: 'Emergency exits around the hall.' },
};
const PLACE_EXTRA = {
  'Toilets': { words: 'toilet wc restroom restrooms bathroom loo', info: 'Toilets.' },
  'Smoking Area': { words: 'smoking smoke cigarette', info: 'Smoking area outside the hall.' },
  'Gaming Area': { words: 'gaming games play', info: 'Gaming area.' },
  'Dart Area': { words: 'darts dart games play', info: 'Darts.' },
  'Cisco': { words: 'cisco partner', info: 'Cisco area.' },
  'PhotoBus': { words: 'photo photos picture pictures', info: 'Photo bus.' },
  'Café': { words: 'coffee cafe', info: 'Café.' },
  'Matchmaking': { words: 'matchmaking networking meet meeting', info: 'Matchmaking area by the entrance.' },
  'Foyer': { words: 'foyer', info: 'Foyer in the middle of the hall.' },
};
const slugify = (t) => fold(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const places = (() => {
  const map = new Map();
  const add = (name, kind, item) => {
    const id = slugify(name);
    if (!map.has(id)) map.set(id, { id, name, kind, items: [] });
    map.get(id).items.push(item);
  };
  for (const r of venue.rooms) if (r.name) add(r.name, r.kind, r);
  add('Entrance', 'entrance', { x: 70, y: 412 });
  add('Matchmaking', 'area', { x: 31, y: 328 });
  add('Foyer', 'area', { x: 466, y: 330 });
  for (const [x, y] of venue.exits) add('Emergency exits', 'exit', { x, y });
  const list = [...map.values()];
  for (const p of list) {
    const k = KINDS[p.kind] || KINDS.area;
    const extra = PLACE_EXTRA[p.name] || {};
    p.kindLabel = k.label;
    p.info = extra.info || k.info;
    p.search = fold(`${p.name} ${k.label} ${k.words} ${extra.words || ''}`);
    p.points = p.items.flatMap((it) => (it.poly ? it.poly : [[it.x, it.y]]));
  }
  return list.sort((a, b) => a.kindLabel.localeCompare(b.kindLabel) || a.name.localeCompare(b.name));
})();
const placeById = new Map(places.map((p) => [p.id, p]));
const placeByName = new Map(places.map((p) => [p.name, p]));

// ---------- state ----------

const ui = {
  selected: null,
  place: null,     // selected place id (room or area)
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
      setInsetBottom: noop, highlightPlace: noop, focusPlan: noop, placeScreenPoint: () => null,
      screenPoint: () => null, onFrame: null,
    });
  }
}
const scene = createScene();
$('totalCount').textContent = startups.length;

function matches(s) {
  if (ui.filter === 'places') return false;
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

function placeMatches(p) {
  if (ui.filter !== 'all' && ui.filter !== 'places') return false;
  if (!ui.query) return ui.filter === 'places';
  if (/^\d+$/.test(ui.query)) return false;
  return p.search.includes(ui.query);
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

const PLACE_ICON = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 18s5.5-5.2 5.5-9.6A5.5 5.5 0 0 0 4.5 8.4C4.5 12.8 10 18 10 18z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="8.4" r="2" fill="currentColor"/></svg>';

function placeRow(p) {
  const n = p.items.length;
  const sub = n > 1 ? `${p.kindLabel} · ${n} locations` : p.kindLabel;
  return `<li class="item place kind-${esc(p.kind)}" data-place="${esc(p.id)}" ${ui.place === p.id ? 'aria-current="true"' : ''}>
    <button type="button" class="item-main" data-act="place" aria-label="${esc(p.name)}, ${esc(sub)}">
      <span class="num">${PLACE_ICON}</span>
      <span class="txt"><span class="name">${esc(p.name)}</span><span class="sub">${esc(sub)}</span></span>
    </button>
  </li>`;
}

const noteTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

// The Notes view: general notes first, then the startups you wrote a note on.
function renderNotesView(items) {
  const q = ui.query;
  const notes = store.generalNotes().filter((n) => !q || fold(n.text).includes(q));
  $('resultCount').textContent = `${notes.length} note${notes.length === 1 ? '' : 's'} · ${items.length} startup${items.length === 1 ? '' : 's'} with notes`;
  const rows = [];
  if (notes.length) {
    rows.push('<li class="section">General notes</li>');
    for (const n of notes) {
      rows.push(`<li class="gnote" data-gnote="${esc(n.id)}" ${editingNote === n.id ? 'aria-current="true"' : ''}>
        <p>${esc(n.text)}</p>
        <div class="gn-meta"><time>${esc(noteTimeFmt.format(new Date(n.created_at || Date.now())))}</time>
          <span class="gn-actions"><button type="button" data-gact="edit">Edit</button><button type="button" data-gact="delete">Delete</button></span></div>
      </li>`);
    }
  }
  if (items.length) {
    rows.push('<li class="section">Notes on startups</li>');
    for (const s of items) {
      const m = store.get(s.id);
      const preview = (m.note || '').trim().replace(/\s+/g, ' ');
      rows.push(`<li class="item" data-id="${esc(s.id)}" ${ui.selected === s.id ? 'aria-current="true"' : ''}>
        <button type="button" class="item-main" data-act="open" aria-label="${esc(s.name)}, booth ${esc(boothLabel(s.booths))}">
          <span class="num">${esc(s.booths.length > 1 ? `${s.booths[0]}+` : s.booths[0])}</span>
          <span class="txt"><span class="name">${esc(s.name)}</span><span class="sub">${esc(preview)}</span></span>
        </button>
      </li>`);
    }
  }
  if (!rows.length) {
    rows.push(`<li class="empty">${q ? 'No note matches your search.' : 'No notes yet. Write your first one above, or add a note on any startup.'}</li>`);
  }
  $('list').innerHTML = rows.join('');
}

function renderList() {
  const items = sorted(startups.filter(matches));
  $('notesComposer').hidden = ui.filter !== 'notes';
  $('notesBtn').setAttribute('aria-pressed', ui.filter === 'notes');
  if (ui.filter === 'notes') { renderNotesView(items); return; }
  const placeHits = places.filter(placeMatches);
  if (ui.filter === 'places') {
    $('resultCount').textContent = `${placeHits.length} places`;
    $('list').innerHTML = placeHits.length ? placeHits.map(placeRow).join('') : '<li class="empty">No place matches your search.</li>';
    return;
  }
  $('resultCount').textContent = filtering()
    ? `${items.length} of ${startups.length} exhibitors${placeHits.length ? ` · ${placeHits.length} places` : ''}`
    : `${startups.length} exhibitors`;
  const rows = [];
  if (placeHits.length) {
    rows.push('<li class="section">Places</li>', ...placeHits.map(placeRow));
    if (items.length) rows.push('<li class="section">Exhibitors</li>');
  }
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
  if (!items.length && !placeHits.length) {
    rows.push(`<li class="empty">${ui.filter === 'all' ? 'No exhibitor or place matches your search.' : 'Nothing here yet. Mark booths from the map or the list.'}</li>`);
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
  const gact = e.target.closest('button[data-gact]');
  if (gact) {
    const id = gact.closest('li[data-gnote]').dataset.gnote;
    if (gact.dataset.gact === 'edit') startEditNote(id);
    else if (confirm('Delete this note?')) {
      if (editingNote === id) resetComposer();
      store.deleteNote(id);
    }
    return;
  }
  const btn = e.target.closest('button[data-act]');
  if (btn?.dataset.act === 'place') { selectPlace(btn.closest('li').dataset.place); return; }
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

function renderPlaceDetail(p) {
  const chips = [`<span class="tag booth">${esc(p.kindLabel)}</span>`];
  if (p.items.length > 1) chips.push(`<span class="tag">${p.items.length} locations</span>`);
  $('detailChips').innerHTML = chips.join('');
  $('detailName').textContent = p.name;
  $('detailDesc').textContent = p.info || `${p.name} on the floor plan.`;
  $('detailDesc').className = 'detail-desc';
  $('detailLinks').innerHTML = '';
  $('personalSection').hidden = true;
  $('boothNotes').hidden = true;
  $('ownBoothBtn').hidden = true;
  detail.hidden = false;
  updateInset();
}

function renderDetail() {
  const place = placeById.get(ui.place);
  if (place) { renderPlaceDetail(place); return; }
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

// Keep the selected booth in view: on wide screens the card floats over the map's lower left,
// on phones the list sheet covers the bottom of the map.
function updateInset() {
  const overMap = !detail.hidden && detail.parentElement?.classList.contains('map-pane');
  scene.setInsetLeft(overMap ? detail.offsetWidth + 14 : 0);
  scene.setInsetBottom(sheetMode.matches ? sheet.height : 0);
}

function markCurrentInList() {
  for (const li of $('list').querySelectorAll('li[data-id], li[data-place]')) {
    const on = li.dataset.id ? li.dataset.id === ui.selected : li.dataset.place === ui.place;
    if (on) li.setAttribute('aria-current', 'true');
    else li.removeAttribute('aria-current');
  }
}

function selectPlace(id, { fly = true } = {}) {
  flushNote();
  const p = placeById.get(id);
  if (!p) return;
  if (chat?.isOpen() && chat.docked()) chat.close();
  hideWelcome();
  ui.selected = null;
  ui.place = p.id;
  scene.select(null);
  scene.highlightPlace(p.items);
  if (fly) scene.focusPlan(p.points);
  renderDetail();
  markCurrentInList();
  revealForSelection();
  history.replaceState(null, '', `#place-${p.id}`);
}

function select(id, { fly = false, scroll = false } = {}) {
  flushNote();
  const s = id ? byId.get(id) : null;
  if (s && chat?.isOpen() && chat.docked()) chat.close();
  ui.selected = s ? s.id : null;
  if (ui.place) { ui.place = null; scene.highlightPlace(null); }
  if (ui.spotlight && ui.spotlight !== ui.selected) hideWelcome();
  scene.select(s ? s.booths : null);
  if (s && fly) scene.focus(s.booths);
  renderDetail();
  markCurrentInList();
  if (s && scroll) scrollListTo(s.id);
  if (s) revealForSelection();
  const hash = s ? `#${s.id}` : ' ';
  history.replaceState(null, '', hash === ' ' ? location.pathname + location.search : hash);
}

$('detailClose').addEventListener('click', () => {
  select(null);
  if (sheetMode.matches && sheet.state === 'card') setSheet('half');
});
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

// ---------- list sheet on phones: pull down to see the whole map, pull up to browse ----------

const sheetMode = window.matchMedia('(max-width: 860px) and (min-height: 561px)');
const sidebar = document.querySelector('.sidebar');
const layout = document.querySelector('.layout');
const handle = $('sheetHandle');
const sheet = { state: 'half', height: 0 };

// Height of the open card's content, so a short card (a place) doesn't take half the screen.
function cardContentHeight() {
  if (detail.hidden || detail.parentElement !== sidebar) return 0;
  const prev = detail.style.bottom;
  detail.style.bottom = 'auto';
  const h = detail.offsetHeight;
  detail.style.bottom = prev;
  return h;
}

function sheetSnaps() {
  const H = layout.clientHeight;
  const peek = handle.offsetHeight + document.querySelector('.side-head .search').offsetHeight + 10;
  const half = Math.round(H * 0.5);
  const card = Math.max(peek, Math.min(half, handle.offsetHeight + cardContentHeight()));
  return { peek, half, card, full: H - 48 };
}

function applySheetHeight(h, animate) {
  sidebar.classList.toggle('dragging', !animate);
  sidebar.style.height = `${h}px`;
  layout.style.setProperty('--sheet-h', `${h}px`);
  // A tall sheet would push the legend up over the map buttons; fade it out instead.
  layout.classList.toggle('sheet-tall', h > layout.clientHeight * 0.7);
  sheet.height = h;
}

function setSheet(state, animate = true) {
  if (!sheetMode.matches) return;
  sheet.state = state;
  applySheetHeight(sheetSnaps()[state], animate);
  sidebar.dataset.sheet = state;
  handle.setAttribute('aria-expanded', state !== 'peek');
  handle.setAttribute('aria-label', state === 'peek' ? 'Show the list' : 'Hide the list and show the map');
  updateInset();
}

// A booth or place chosen while the list is folded away or covers the map: show its card and the map.
function revealForSelection() {
  if (sheetMode.matches) setSheet('card');
}

function resetSheet() {
  if (sheetMode.matches) setSheet(sheet.state, false);
  else {
    sidebar.style.height = '';
    layout.style.removeProperty('--sheet-h');
    layout.classList.remove('sheet-tall');
    sheet.height = 0;
    updateInset();
  }
}
sheetMode.addEventListener('change', resetSheet);
window.addEventListener('resize', () => { if (sheetMode.matches) setSheet(sheet.state, false); });

(() => {
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    if (!sheetMode.matches) return;
    handle.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, h: sheet.height, t: performance.now(), lastY: e.clientY, lastT: performance.now(), moved: 0 };
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { peek, full } = sheetSnaps();
    drag.moved = Math.max(drag.moved, Math.abs(e.clientY - drag.y));
    drag.v = (e.clientY - drag.lastY) / Math.max(1, performance.now() - drag.lastT);
    drag.lastY = e.clientY;
    drag.lastT = performance.now();
    applySheetHeight(Math.max(peek, Math.min(full, drag.h - (e.clientY - drag.y))), false);
  });
  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    const snaps = sheetSnaps();
    if (d.moved < 6) { setSheet(sheet.state === 'peek' ? 'half' : 'peek'); return; }
    const order = ['peek', 'half', 'full'];
    let i = order.indexOf(order.reduce((best, k) => (Math.abs(snaps[k] - sheet.height) < Math.abs(snaps[best] - sheet.height) ? k : best), 'half'));
    // A quick flick moves one step in its direction even if the finger did not travel far.
    if (d.v > 0.45) i = Math.max(0, order.indexOf(sheet.state) - 1);
    else if (d.v < -0.45) i = Math.min(2, order.indexOf(sheet.state) + 1);
    setSheet(order[i]);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); setSheet(sheet.state === 'peek' ? 'half' : 'full'); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSheet(sheet.state === 'full' ? 'half' : 'peek'); }
  });
})();

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
  const room = e.detail.room ? placeByName.get(e.detail.room) : null;
  if (s) select(s.id, { scroll: true });
  else if (room) selectPlace(room.id, { fly: false });
  else select(null);
});

const nameTag = $('nameTag');
scene.onFrame = () => {
  const place = placeById.get(ui.place);
  const s = place ? null : byId.get(ui.selected || ui.spotlight);
  const p = place ? scene.placeScreenPoint() : s ? scene.screenPoint(s.booths) : null;
  if (!p) { nameTag.hidden = true; return; }
  nameTag.textContent = place ? place.name : s.name;
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
const syncSearchClear = () => { $('searchClear').hidden = !$('search').value; };
$('search').addEventListener('input', () => {
  syncSearchClear();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    ui.query = fold($('search').value.trim());
    renderList();
    refreshBooths();
  }, 120);
});
$('search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const first = $('list').querySelector('li[data-id]:not(.mine), li[data-place]');
  if (!first) return;
  if (first.dataset.place) selectPlace(first.dataset.place);
  else select(first.dataset.id, { fly: true });
  $('search').blur();
});
$('search').addEventListener('focus', () => { if (sheetMode.matches && sheet.state !== 'full') setSheet('full'); });
// The ✕ clears the search in one tap. Pressing it does not take focus from the field, so a phone
// keyboard that is open stays open for the next search.
$('searchClear').addEventListener('pointerdown', (e) => e.preventDefault());
$('searchClear').addEventListener('click', () => {
  const input = $('search');
  const wasFocused = document.activeElement === input;
  clearTimeout(searchTimer);
  input.value = '';
  ui.query = '';
  syncSearchClear();
  renderList();
  refreshBooths();
  if (wasFocused || !sheetMode.matches) input.focus();
});
// Tapping the magnifier or padding of the search bar focuses the field (it used to be a label).
$('searchBox').addEventListener('click', (e) => { if (!e.target.closest('button, input')) $('search').focus(); });

// ---------- general notes ----------

let editingNote = null;

function resetComposer() {
  editingNote = null;
  $('gnInput').value = '';
  $('gnLabel').textContent = 'New note';
  $('gnSave').textContent = 'Add note';
  $('gnCancel').hidden = true;
}

function startEditNote(id) {
  const n = store.notes.items[id];
  if (!n) return;
  editingNote = id;
  $('gnInput').value = n.text || '';
  $('gnLabel').textContent = 'Edit note';
  $('gnSave').textContent = 'Save';
  $('gnCancel').hidden = false;
  renderList();
  if (sheetMode.matches && sheet.state !== 'full') setSheet('full');
  $('gnInput').focus();
}

function saveNote() {
  if (!requireSignIn('notes')) return;
  const text = $('gnInput').value.trim();
  if (!text) { $('gnInput').focus(); return; }
  if (editingNote) store.updateNote(editingNote, text);
  else store.addNote(text);
  resetComposer();
  $('list').scrollTo({ top: 0 });
}

$('gnSave').addEventListener('click', saveNote);
$('gnCancel').addEventListener('click', () => { resetComposer(); renderList(); });
$('gnInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveNote(); }
});

// The pencil next to search: open My notes, ready to write.
$('notesBtn').addEventListener('click', () => {
  if (ui.filter === 'notes') { setFilter('all'); return; }
  if (!requireSignIn('notes')) return;
  setFilter('notes');
  if (sheetMode.matches && sheet.state !== 'full') setSheet('full');
  $('gnInput').focus();
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
    if (!['all', 'places'].includes(chip.dataset.filter) && !requireSignIn('mark')) return;
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
  const general = store.generalNotes();
  if (!rows.length && !general.length) {
    $('exportBtn').textContent = 'Nothing marked yet';
    setTimeout(() => { $('exportBtn').textContent = 'Export my notes'; }, 1800);
    return;
  }
  downloadCsv('startup-nights-2026-my-notes.csv', ['Startup', 'Booth', 'Visited', 'Interested', 'Note', 'Website', 'Category', 'Written'], [
    ...general.map((n) => ['General note', '', '', '', n.text, '', '', new Date(n.created_at).toLocaleString()]),
    ...rows.map(({ s, m }) => [s.name, boothLabel(s.booths), m.visited ? 'yes' : '', m.interested ? 'yes' : '', m.note || '', s.website || '', s.category || '', '']),
  ]);
});

// ---------- sign-in ----------

const modal = $('authModal');
let authEmail = '';
let authReason = null;

const REASONS = {
  intro: 'Sign in with your email to mark booths you visit and keep private notes. Only you can see them, on any device.',
  mark: 'Sign in to mark booths and keep notes. Your notes are private: only you can see them.',
  booth: 'Sign in to keep private notes about the people who visit your booth.',
  notes: 'Sign in to write notes. They are private: only you can see them, on any device.',
  chat: 'Sign in with your email to post in the live chat. Everyone can read it; your email is never shown.',
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
  if (!store.user && !['all', 'places'].includes(ui.filter)) setFilter('all');
  if (!store.user) resetComposer();
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
resetSheet();
requestAnimationFrame(() => {
  const el = $('loading');
  el.classList.add('gone');
  setTimeout(() => el.remove(), 400);
});

const fromHash = decodeURIComponent(location.hash.slice(1));
if (fromHash.startsWith('place-') && placeById.has(fromHash.slice(6))) selectPlace(fromHash.slice(6));
else if (fromHash) {
  const s = byId.get(fromHash) || byBooth.get(fromHash.padStart(3, '0'));
  if (s) select(s.id, { fly: true, scroll: true });
}

await store.init();
renderAccount();
chat = initChat({ store, esc, requireSignIn });
// First visit without an account: offer sign-in once, with the option to just browse.
if (store.backend && !store.signedIn && storageGet(BROWSE_KEY) !== '1') openAuth('intro');
