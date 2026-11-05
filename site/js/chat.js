// Public live chat for everyone at Startup Nights.
// Anyone can read it; signed-in visitors post under a chat name they choose (never their email),
// with an optional photo. Signed-in visitors get new messages live over Langrove realtime;
// everyone else (and anyone whose live connection drops) polls the same endpoint.

import { api } from './store.js';

const CHANNEL = 'chat/public';
const SEEN_KEY = 'sn26.chat.seen';
const POLL_OPEN = 4000;          // chat open, no live connection
const POLL_OPEN_LIVE = 30000;    // chat open, live: a safety net only
const POLL_CLOSED = 60000;       // chat closed: keeps the unread badge current
const RECONCILE_MS = 60000;      // re-read the latest page now and then to drop removed messages
const PHOTO_MAX_SIDE = 1600;
const GROUP_MS = 5 * 60000;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

export function initChat({ store, esc, requireSignIn }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('chat');
  const scroller = $('chatScroll');
  const listEl = $('chatList');
  const input = $('chatInput');
  const buttons = [$('chatBtn'), $('chatBtnSm')];
  const badges = [$('chatBadge'), $('chatBadgeSm')];
  const overlayMode = matchMedia('(max-width: 860px), (max-height: 560px)');

  const msgs = new Map();     // id -> message
  const nodes = new Map();    // id -> <li>
  let cursor = 0;             // server time of the last fetch
  let more = false;           // older messages exist
  let olderLoaded = false;
  let open = false;
  let live = false;
  let ok = true;              // last request succeeded
  let enabled = true;
  let rt = null, offChannel = null, offWatch = null;
  let pollTimer = null;
  let lastFull = 0;
  let attach = null;          // { blob, w, h, url }
  let sending = false;
  let stickToBottom = false;
  let incoming = 0;           // new messages from others since the last render
  let seen = Number(lsGet(SEEN_KEY)) || 0;
  let uid = undefined;
  let lastFocus = null;
  let renaming = false;       // the name form is open to change an existing name

  // ---------- data ----------

  function put(m) {
    if (!m || !m.id) return;
    if (m.deleted) { remove(m.id); return; }
    const cur = msgs.get(m.id);
    if (cur && (cur.changed_at || 0) > (m.changed_at || 0)) return;
    if (!cur && m.author !== store.user?.id) incoming++;
    msgs.set(m.id, cur ? { ...m, image: cur.image && m.image ? { ...m.image, url: cur.image.url } : m.image } : m);
  }
  function remove(id) { msgs.delete(id); }

  async function fetchLatest() {
    const res = await api('GET', '/chat/messages');
    const ids = new Set(res.messages.map((m) => m.id));
    const from = res.messages.length ? res.messages[0].created_at : 0;
    // The newest page is the truth for its time span: anything missing there was removed.
    for (const [id, m] of msgs) if (m.created_at >= from && !ids.has(id)) msgs.delete(id);
    res.messages.forEach(put);
    if (!olderLoaded) more = !!res.more;
    cursor = Math.max(cursor, res.now || 0);
    lastFull = Date.now();
  }

  async function fetchChanges() {
    if (!cursor) return fetchLatest();
    const res = await api('GET', `/chat/messages?after=${Math.max(1, cursor - 5000)}`);
    res.messages.forEach(put);
    cursor = Math.max(cursor, res.now || 0);
  }

  async function loadOlder() {
    const oldest = [...msgs.values()].reduce((t, m) => Math.min(t, m.created_at), Infinity);
    if (!Number.isFinite(oldest)) return;
    const btn = $('chatOlder');
    btn.disabled = true;
    try {
      const res = await api('GET', `/chat/messages?before=${oldest}`);
      const h = scroller.scrollHeight;
      const keepIncoming = incoming;
      res.messages.forEach(put);
      incoming = keepIncoming;       // older messages are not new
      more = !!res.more;
      olderLoaded = true;
      render({ keepScroll: false });
      scroller.scrollTop += scroller.scrollHeight - h;   // stay on the same message
    } catch { /* try again on the next tap */ }
    btn.disabled = false;
  }

  // Photo links expire after a few minutes; fetch fresh ones for photos that fail to load.
  const photoRetry = new Set();
  let photoTimer = null;
  function refreshPhoto(id) {
    photoRetry.add(id);
    clearTimeout(photoTimer);
    photoTimer = setTimeout(async () => {
      const ids = [...photoRetry].slice(0, 50);
      photoRetry.clear();
      try {
        const res = await api('GET', `/chat/messages?ids=${ids.join(',')}`);
        for (const m of res.messages) {
          const cur = msgs.get(m.id);
          if (!cur || !m.image) continue;
          cur.image = m.image;
          const img = nodes.get(m.id)?.querySelector('img');
          if (img && img.dataset.retried !== '1') { img.dataset.retried = '1'; img.src = m.image.url; }
        }
      } catch { /* leave the broken photo */ }
    }, 250);
  }

  // ---------- rendering ----------

  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
  const scrollToBottom = () => { scroller.scrollTop = scroller.scrollHeight; $('chatJump').hidden = true; };

  function fmtTime(ts) {
    const d = new Date(ts);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
  }

  // Escape everything; turn web addresses into links that open in a new tab.
  function linkify(text) {
    const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
    let out = '', last = 0, m;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index));
      out += `<a href="${esc(m[0])}" target="_blank" rel="noopener nofollow ugc">${esc(m[0])}</a>`;
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  function build(m) {
    const li = document.createElement('li');
    const mine = !!store.user && m.author === store.user.id;
    const canRemove = mine || !!store.user?.chat_host;
    li.className = `msg${mine ? ' mine' : ''}${m.host ? ' is-host' : ''}`;
    li.dataset.id = m.id;
    const w = m.image?.w || 4, h = m.image?.h || 3;
    const photo = m.image
      ? `<button type="button" class="msg-photo" data-photo aria-label="Open the photo from ${esc(m.name)}"><img src="${esc(m.image.url)}" alt="Photo from ${esc(m.name)}" loading="lazy" decoding="async" width="${w}" height="${h}" style="aspect-ratio:${w}/${h}"></button>`
      : '';
    const del = canRemove
      ? `<button type="button" class="msg-del" data-del aria-label="${mine ? 'Delete your message' : `Remove the message from ${esc(m.name)}`}" title="${mine ? 'Delete' : 'Remove'}"><svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
      : '';
    li.innerHTML = `
      <div class="msg-meta"><span class="msg-name">${mine ? 'You' : esc(m.name)}</span>${m.host ? '<span class="host-badge">Host</span>' : ''}<time datetime="${new Date(m.created_at).toISOString()}">${fmtTime(m.created_at)}</time></div>
      <div class="msg-row"><div class="msg-bubble">${photo}${m.text ? `<p class="msg-text">${linkify(m.text)}</p>` : ''}</div>${del}</div>`;
    const img = li.querySelector('img');
    if (img) {
      img.addEventListener('error', () => refreshPhoto(m.id));
      img.addEventListener('load', () => { if (stickToBottom) scrollToBottom(); });
    }
    return li;
  }

  function render({ keepScroll = true } = {}) {
    const wasAtBottom = !open || nearBottom();
    for (const [id, li] of nodes) if (!msgs.has(id)) { li.remove(); nodes.delete(id); }
    const list = [...msgs.values()].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
    let prev = null;
    list.forEach((m, i) => {
      let li = nodes.get(m.id);
      if (!li) { li = build(m); nodes.set(m.id, li); }
      li.classList.toggle('cont', !!prev && prev.author === m.author && m.created_at - prev.created_at < GROUP_MS);
      if (listEl.children[i] !== li) listEl.insertBefore(li, listEl.children[i] || null);
      prev = m;
    });
    $('chatEmpty').hidden = list.length > 0 || !ok && !list.length && !cursor;
    $('chatOlder').hidden = !more;
    if (open && keepScroll) {
      if (wasAtBottom || stickToBottom) scrollToBottom();
      else if (incoming) $('chatJump').hidden = false;
    }
    incoming = 0;
    if (open && !document.hidden) markSeen();
    updateBadge();
  }

  function rebuild() {
    nodes.forEach((li) => li.remove());
    nodes.clear();
    render();
  }

  // ---------- unread badge ----------

  function markSeen() {
    let latest = seen;
    for (const m of msgs.values()) latest = Math.max(latest, m.created_at);
    if (latest !== seen) { seen = latest; lsSet(SEEN_KEY, String(seen)); }
  }

  function updateBadge() {
    let n = 0;
    if (!open) for (const m of msgs.values()) if (m.created_at > seen && m.author !== store.user?.id) n++;
    const label = n ? `Open the live chat, ${n} new message${n === 1 ? '' : 's'}` : 'Open the live chat';
    badges.forEach((b) => { b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n); });
    buttons.forEach((b) => b.setAttribute('aria-label', label));
  }

  function setStatus() {
    const dot = $('chatDot');
    dot.className = `chat-dot ${ok ? 'on' : 'off'}`;
    dot.title = !ok ? 'Reconnecting…' : live ? 'Live' : 'Updating every few seconds';
  }

  // ---------- updates: realtime when signed in, polling otherwise ----------

  function schedule(delay) {
    clearTimeout(pollTimer);
    if (!enabled || document.hidden) return;
    const ms = delay ?? (open ? (live ? POLL_OPEN_LIVE : POLL_OPEN) : POLL_CLOSED);
    pollTimer = setTimeout(tick, ms);
  }

  async function tick() {
    try {
      if (Date.now() - lastFull > RECONCILE_MS) await fetchLatest();
      else await fetchChanges();
      ok = true;
    } catch (e) {
      ok = false;
      if (e.status === 404) { disable(); return; }
    }
    setStatus();
    render();
    schedule();
  }

  function unwrap(b, depth = 0) {
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return null; } }
    if (!b || typeof b !== 'object' || depth > 3) return null;
    if (b.chat === 1) return b;
    for (const k of ['payload', 'data', 'body', 'event', 'message']) {
      const r = unwrap(b[k], depth + 1);
      if (r) return r;
    }
    return null;
  }

  function onLive(body) {
    const e = unwrap(body);
    if (!e) return;
    if (e.type === 'message' && e.message) put(e.message);
    else if (e.type === 'deleted') [...(e.ids || []), ...(e.id ? [e.id] : [])].forEach(remove);
    render();
  }

  function stopRealtime() {
    try { offChannel?.(); offWatch?.(); rt?.close?.(); } catch { /* already closed */ }
    rt = offChannel = offWatch = null;
    live = false;
  }

  async function startRealtime() {
    stopRealtime();
    const client = window.devcore;
    if (!store.user || !client || typeof client.realtime !== 'function') return;
    try {
      const r = await client.realtime();
      if (!store.user || rt) { r.close?.(); return; }
      rt = r;
      if (!r.enabled) return;
      offWatch = r.watch((event) => {
        if (event === 'subscribed') {
          live = true;
          fetchChanges().then(() => { ok = true; render(); }).catch(() => {}); // catch up on anything missed
        } else if (event === 'down' || event === 'refused') live = false;
        setStatus();
        schedule();
      });
      offChannel = r.on(CHANNEL, onLive);
    } catch {
      rt = null;
    }
  }

  // ---------- open / close ----------

  function fit() {
    const vv = window.visualViewport;
    // Docked beside the map: cover exactly the list column.
    panel.style.width = open && !overlayMode.matches ? `${document.querySelector('.sidebar')?.offsetWidth || 380}px` : '';
    if (!open || !overlayMode.matches || !vv) { panel.style.top = ''; panel.style.height = ''; return; }
    const atBottom = nearBottom();
    panel.style.top = `${vv.offsetTop}px`;
    panel.style.height = `${vv.height}px`;
    if (atBottom) scrollToBottom();
  }

  function openChat() {
    if (!enabled) return;
    if (open) { if (!overlayMode.matches) input.focus(); return; }
    open = true;
    lastFocus = document.activeElement;
    panel.hidden = false;
    document.body.classList.add('chat-open');
    buttons.forEach((b) => b.setAttribute('aria-expanded', 'true'));
    renderFoot();
    fit();
    render({ keepScroll: false });
    scrollToBottom();
    stickToBottom = true;
    setTimeout(() => { stickToBottom = false; }, 1500);
    tick();
    if (!overlayMode.matches && !input.closest('[hidden]')) input.focus();
    else $('chatClose').focus({ preventScroll: true });
  }

  function closeChat() {
    if (!open) return;
    open = false;
    panel.hidden = true;
    document.body.classList.remove('chat-open');
    buttons.forEach((b) => b.setAttribute('aria-expanded', 'false'));
    $('chatJump').hidden = true;
    fit();
    updateBadge();
    schedule();
    if (lastFocus && document.contains(lastFocus) && !overlayMode.matches) lastFocus.focus({ preventScroll: true });
  }

  function renderFoot() {
    const u = store.user;
    const named = !!(u && u.display_name);
    $('chatSignin').hidden = !!u;
    $('chatNameForm').hidden = !u || (named && !renaming);
    $('chatForm').hidden = !u || !named || renaming;
    $('chatAs').textContent = u?.display_name || '';
    $('chatSub').textContent = u?.chat_host ? 'Host: you can remove any message' : 'Everyone at the event can read this';
  }

  // ---------- chat name ----------

  function startRename() {
    renaming = true;
    $('chatNameInput').value = store.user?.display_name || '';
    $('chatNameError').textContent = '';
    renderFoot();
    $('chatNameInput').focus();
  }

  $('chatNameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('chatNameInput').value.replace(/\s+/g, ' ').trim();
    const err = $('chatNameError');
    if (name.length < 2) { err.textContent = 'Please use at least 2 characters.'; return; }
    $('chatNameSave').disabled = true;
    err.textContent = '';
    try {
      const me = await api('PATCH', '/visitors/me', { display_name: name });
      Object.assign(store.user, me);
      renaming = false;
      store.emit('auth', { user: store.user });
      renderFoot();
      input.focus();
    } catch (ex) {
      err.textContent = ex.status ? ex.message : 'Could not save. Check your connection and try again.';
    } finally {
      $('chatNameSave').disabled = false;
    }
  });
  $('chatRename').addEventListener('click', startRename);

  // ---------- photos ----------

  async function decode(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  // Resize on the device (fast uploads on event Wi-Fi) and re-encode, which also drops the
  // photo's hidden details such as GPS location.
  async function preparePhoto(file) {
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) throw new Error('Please choose a photo.');
    if (file.size > 30 * 1024 * 1024) throw new Error('That photo is too large (30 MB at most).');
    let src;
    try { src = await decode(file); } catch { throw new Error('This photo could not be read. Try a JPEG or PNG.'); }
    const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.drawImage(src, 0, 0, w, h);
    src.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error('This photo could not be prepared. Try another one.');
    return { blob, w, h, url: URL.createObjectURL(blob) };
  }

  function setAttach(a) {
    if (attach) URL.revokeObjectURL(attach.url);
    attach = a;
    $('chatAttach').hidden = !a;
    if (a) {
      $('chatPreview').src = a.url;
      $('chatAttachInfo').textContent = `Photo ready · ${Math.max(1, Math.round(a.blob.size / 1024))} KB`;
    } else $('chatPreview').removeAttribute('src');
  }

  async function takeFile(file) {
    if (!file) return;
    $('chatError').textContent = '';
    $('chatAttachInfo').textContent = 'Preparing photo…';
    try {
      setAttach(await preparePhoto(file));
      input.focus();
    } catch (ex) {
      $('chatError').textContent = ex.message;
    }
  }

  $('chatPhotoBtn').addEventListener('click', () => $('chatFile').click());
  $('chatFile').addEventListener('change', () => {
    const f = $('chatFile').files[0];
    $('chatFile').value = '';
    takeFile(f);
  });
  $('chatAttachRemove').addEventListener('click', () => { setAttach(null); input.focus(); });
  input.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); takeFile(f); }
  });

  // ---------- sending ----------

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + 2, 132)}px`;
  }

  async function send() {
    if (sending) return;
    if (!requireSignIn('chat')) return;
    if (!store.user.display_name) { startRename(); return; }
    const text = input.value.replace(/\s+$/g, '').replace(/^\s+/g, '');
    if (!text && !attach) { input.focus(); return; }
    sending = true;
    $('chatSend').disabled = true;
    $('chatForm').classList.add('busy');
    $('chatError').textContent = '';
    try {
      let msg;
      if (attach) {
        $('chatAttachInfo').textContent = 'Sending photo…';
        const res = await api('POST', '/chat/messages', { text, image: { contentType: attach.blob.type || 'image/jpeg', w: attach.w, h: attach.h } });
        const up = await fetch(res.uploadUrl, { method: 'PUT', headers: { 'Content-Type': res.contentType }, body: attach.blob });
        if (!up.ok) throw new Error('The photo could not be uploaded. Please try again.');
        msg = (await api('POST', `/chat/messages/${res.id}/publish`, {})).message;
        setAttach(null);
      } else {
        msg = (await api('POST', '/chat/messages', { text })).message;
      }
      input.value = '';
      autosize();
      put(msg);
      stickToBottom = true;
      render();
      scrollToBottom();
      setTimeout(() => { stickToBottom = false; }, 1500);
    } catch (ex) {
      if (attach) $('chatAttachInfo').textContent = 'Photo ready to send';
      if (ex.status === 400 && /chat name/i.test(ex.message)) startRename();
      else $('chatError').textContent = ex.status ? ex.message : 'Could not send. Check your connection and try again.';
    } finally {
      sending = false;
      $('chatSend').disabled = false;
      $('chatForm').classList.remove('busy');
    }
  }

  $('chatForm').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', () => { autosize(); if ($('chatError').textContent) $('chatError').textContent = ''; });
  input.addEventListener('focus', () => { if (overlayMode.matches) setTimeout(fit, 300); });

  // ---------- list actions ----------

  listEl.addEventListener('click', async (e) => {
    const photo = e.target.closest('[data-photo]');
    if (photo) {
      const img = photo.querySelector('img');
      $('photoFull').src = img.currentSrc || img.src;
      $('photoFull').alt = img.alt;
      $('photoModal').showModal();
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const li = del.closest('li');
      const mine = li.classList.contains('mine');
      if (!confirm(mine ? 'Delete this message for everyone?' : 'Remove this message for everyone?')) return;
      del.disabled = true;
      try {
        await api('DELETE', `/chat/messages/${li.dataset.id}`);
        remove(li.dataset.id);
        render();
      } catch (ex) {
        del.disabled = false;
        $('chatError').textContent = ex.status === 403 ? 'Only the author or a host can remove this message.' : 'Could not remove the message. Try again.';
      }
    }
  });

  $('photoClose').addEventListener('click', () => $('photoModal').close());
  $('photoModal').addEventListener('click', (e) => { if (e.target.id !== 'photoClose') $('photoModal').close(); });

  scroller.addEventListener('scroll', () => { if (nearBottom()) $('chatJump').hidden = true; }, { passive: true });
  $('chatJump').addEventListener('click', scrollToBottom);
  $('chatOlder').addEventListener('click', loadOlder);
  $('chatClose').addEventListener('click', closeChat);
  $('chatSigninBtn').addEventListener('click', () => requireSignIn('chat'));
  buttons.forEach((b) => b.addEventListener('click', () => (open ? closeChat() : openChat())));
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('photoModal').open) { e.stopPropagation(); closeChat(); }
  });

  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('scroll', fit);
  overlayMode.addEventListener('change', fit);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(pollTimer);
    else schedule(0);
  });

  // ---------- account changes ----------

  async function onAuth() {
    const id = store.user?.id || null;
    renderFoot();
    if (id === uid) return;     // a profile change, not a different person
    uid = id;
    renaming = false;
    rebuild();                  // "You" labels and remove buttons depend on who is signed in
    try {
      await fetchLatest();      // for a signed-in visitor this also grants the live channel
      ok = true;
    } catch (e) {
      ok = false;
      if (e.status === 404) { disable(); return; }
    }
    render();
    setStatus();
    schedule();
    if (id) startRealtime(); else stopRealtime();
  }

  function disable() {
    // A copy of the site without the backend: no chat.
    enabled = false;
    clearTimeout(pollTimer);
    stopRealtime();
    closeChat();
    buttons.forEach((b) => { b.hidden = true; });
  }

  store.addEventListener('auth', onAuth);

  // ---------- start ----------

  if (!store.backend) { disable(); return { close: closeChat, isOpen: () => false }; }
  buttons.forEach((b) => { b.hidden = false; });
  setStatus();
  onAuth();

  return {
    close: closeChat,
    isOpen: () => open,
    docked: () => !overlayMode.matches,
  };
}
