// AI assistant: anyone can ask where a startup, booth or place is, or send feedback to Langrove.
// Questions go to POST /assistant/messages (a Langrove AI agent with a search tool over the floor
// plan). Answers name startups and places, shown as cards that fly the map to them. If the AI is
// unavailable, the same question is answered from the map's own data instead.
// Feedback also has a plain form (POST /feedback); hosts read it in an inbox (GET /feedback).

import { api } from './store.js';

const CLIENT_KEY = 'sn26.client';       // random id, only for the server's per-browser limits
const HISTORY_KEY = 'sn26.ai';          // this tab's conversation (sessionStorage)
const MAX_TURNS = 16;

const STOP = new Set(('where is are the a an booth booths stand stands of find me show which what who at in on for to startup startups ' +
  'company companies and or with do does i can there any near nearest closest how get go please tell about number no nr ' +
  'located location place places im looking look want see visit some all list work working on').split(' '));

function clientId() {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

export function initAssistant({ store, esc, fold, startups, byId, placeById, boothLabel, showStartup, showPlace, showToast }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('ai');
  const scroller = $('aiScroll');
  const listEl = $('aiList');
  const input = $('aiInput');
  const buttons = [$('aiBtn'), $('aiBtnSm')];
  const overlayMode = matchMedia('(max-width: 860px), (max-height: 560px)');

  let open = false;
  let busy = false;
  let lastFocus = null;
  let turns = [];   // [{role: 'user'|'assistant', text, startups?, places?, note?, error?}]
  try { turns = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); } catch { turns = []; }
  const saveTurns = () => { try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(turns.slice(-MAX_TURNS))); } catch { /* ignore */ } };

  const GREETING = "Hi! I'm the AI assistant of the Startup Nights 2026 booth map. Ask me where a startup, booth or place is, or which startups work on a topic. You can also tell me what you think of the app and I'll pass it on to the Langrove team.";

  // ---------- rendering ----------

  function linkify(text) {
    const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
    let out = '', last = 0, m;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index));
      out += `<a href="${esc(m[0])}" target="_blank" rel="noopener">${esc(m[0])}</a>`;
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  function cards(t) {
    const items = [];
    for (const id of t.startups || []) {
      const s = byId.get(id);
      if (s) items.push(`<button type="button" class="ai-card" data-startup="${esc(s.id)}"><span class="num">${esc(boothLabel(s.booths) || '–')}</span><span class="txt"><b>${esc(s.name)}</b><small>${esc(s.category || 'Booth ' + boothLabel(s.booths))}</small></span><span class="go">Show on map</span></button>`);
    }
    for (const id of t.places || []) {
      const p = placeById.get(id);
      if (p) items.push(`<button type="button" class="ai-card" data-place="${esc(p.id)}"><span class="num place"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 17.5s5.5-5.2 5.5-9.3a5.5 5.5 0 0 0-11 0c0 4.1 5.5 9.3 5.5 9.3z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="10" cy="8.2" r="1.9" fill="currentColor"/></svg></span><span class="txt"><b>${esc(p.name)}</b><small>${esc(p.kindLabel)}${p.items.length > 1 ? ` · ${p.items.length} places` : ''}</small></span><span class="go">Show on map</span></button>`);
    }
    return items.length ? `<div class="ai-cards">${items.join('')}</div>` : '';
  }

  function bubble(t) {
    const li = document.createElement('li');
    li.className = `msg${t.role === 'user' ? ' mine' : ''}${t.error ? ' error' : ''}`;
    li.innerHTML = `<div class="msg-bubble"><p class="msg-text">${linkify(t.text)}</p></div>${t.role === 'assistant' ? cards(t) : ''}${t.note ? `<p class="ai-note${t.noteOk ? ' ok' : ''}">${esc(t.note)}</p>` : ''}`;
    return li;
  }

  function render() {
    listEl.innerHTML = '';
    listEl.appendChild(bubble({ role: 'assistant', text: GREETING }));
    for (const t of turns) listEl.appendChild(bubble(t));
    $('aiSuggest').hidden = turns.length > 0;
    scrollToBottom();
  }

  function append(t) {
    turns.push(t);
    if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
    saveTurns();
    listEl.appendChild(bubble(t));
    $('aiSuggest').hidden = true;
    scrollToBottom();
  }

  const scrollToBottom = () => { scroller.scrollTop = scroller.scrollHeight; };

  let thinkingEl = null;
  function thinking(on) {
    if (on && !thinkingEl) {
      thinkingEl = document.createElement('li');
      thinkingEl.className = 'msg ai-thinking';
      thinkingEl.setAttribute('aria-label', 'The assistant is thinking');
      thinkingEl.innerHTML = '<div class="msg-bubble"><i></i><i></i><i></i></div>';
      listEl.appendChild(thinkingEl);
      scrollToBottom();
    } else if (!on && thinkingEl) {
      thinkingEl.remove();
      thinkingEl = null;
    }
  }

  // ---------- answers from the map itself (when the AI is not available) ----------

  function localAnswer(question) {
    const q = fold(question);
    if (/\b(feedback|suggest|suggestions?|ideas?|bugs?|complain|complaint)\b/.test(q) && !/\b(where|booth)\b/.test(q)) {
      return { text: "The AI assistant isn't available right now, but you can send your feedback with the form. I've opened it for you.", openFeedback: true };
    }
    const nums = (q.match(/\b\d{1,3}\b/g) || []).map((n) => n.padStart(3, '0'));
    const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
    const score = (name, other) => {
      let sc = 0;
      for (const w of words) {
        if (name.split(/[^a-z0-9]+/).includes(w)) sc += 40;
        else if (w.length >= 3 && name.includes(w)) sc += 25;
        else if (w.length >= 3 && other.includes(w)) sc += 4;
      }
      return sc;
    };
    const ss = startups
      .map((s) => ({ s, sc: (nums.some((n) => s.booths.includes(n)) ? 100 : 0) + score(fold(s.name), fold(`${s.category || ''} ${s.description || ''}`)) }))
      .filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 5).map((x) => x.s.id);
    const ps = [...placeById.values()]
      .map((p) => ({ p, sc: score(fold(p.name), p.search) }))
      .filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 3).map((x) => x.p.id);
    if (!ss.length && !ps.length) {
      return { text: "The AI assistant isn't available right now, and I couldn't find that on the map. Try a startup name, a booth number or a place such as \"toilets\", or use the search box." };
    }
    return { text: "The AI assistant isn't available right now, but this is what I found on the map:", startups: ss, places: ps };
  }

  // ---------- asking ----------

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + 2, 132)}px`;
  }

  async function ask(text) {
    const question = String(text || '').replace(/\s+/g, ' ').trim();
    if (!question || busy) return;
    if (question.length > 500) { $('aiError').textContent = 'Please keep it under 500 characters.'; return; }
    const history = turns.slice(-8).map((t) => ({ role: t.role, text: t.text }));
    busy = true;
    $('aiSend').disabled = true;
    $('aiError').textContent = '';
    input.value = '';
    autosize();
    append({ role: 'user', text: question });
    thinking(true);
    try {
      const res = await api('POST', '/assistant/messages', { message: question, history: { turns: history }, client: clientId() });
      thinking(false);
      const known = (ids, map) => (ids || []).filter((id) => map.has(id));
      append({
        role: 'assistant',
        text: res.text,
        startups: known(res.startups, byId),
        places: known(res.places, placeById),
        note: res.feedback_saved ? 'Feedback sent to the Langrove team. Thank you!' : '',
        noteOk: !!res.feedback_saved,
      });
    } catch (e) {
      thinking(false);
      if (e.status === 429) {
        append({ role: 'assistant', text: e.message || 'Lots of questions right now. Please try again in a minute.', error: true });
      } else {
        const a = localAnswer(question);
        append({ role: 'assistant', ...a, error: !a.startups && !a.places });
        if (a.openFeedback) openFeedback();
      }
    } finally {
      busy = false;
      $('aiSend').disabled = false;
      if (!overlayMode.matches) input.focus();
    }
  }

  $('aiForm').addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); }
  });
  input.addEventListener('input', () => { autosize(); $('aiError').textContent = ''; });
  input.addEventListener('focus', () => { if (overlayMode.matches) setTimeout(fit, 300); });
  $('aiSuggest').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ask]');
    if (b) ask(b.dataset.ask);
  });
  listEl.addEventListener('click', (e) => {
    const s = e.target.closest('[data-startup]');
    const p = e.target.closest('[data-place]');
    if (!s && !p) return;
    closeAssistant({ restoreFocus: false });
    if (s) showStartup(s.dataset.startup);
    else showPlace(p.dataset.place);
  });

  // ---------- open / close ----------

  function fit() {
    const vv = window.visualViewport;
    // Docked beside the map: cover exactly the list column.
    panel.style.width = open && !overlayMode.matches ? `${document.querySelector('.sidebar')?.offsetWidth || 380}px` : '';
    if (!open || !overlayMode.matches || !vv) { panel.style.top = ''; panel.style.height = ''; return; }
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
    panel.style.top = `${vv.offsetTop}px`;
    panel.style.height = `${vv.height}px`;
    if (atBottom) scrollToBottom();
  }

  function openAssistant() {
    if (open) { input.focus(); return; }
    open = true;
    lastFocus = document.activeElement;
    panel.hidden = false;
    document.body.classList.add('chat-open');
    buttons.forEach((b) => b.setAttribute('aria-expanded', 'true'));
    fit();
    scrollToBottom();
    if (!overlayMode.matches) input.focus();
    else $('aiClose').focus({ preventScroll: true });
  }

  function closeAssistant({ restoreFocus = true } = {}) {
    if (!open) return;
    open = false;
    panel.hidden = true;
    document.body.classList.remove('chat-open');
    buttons.forEach((b) => b.setAttribute('aria-expanded', 'false'));
    fit();
    if (restoreFocus && lastFocus && document.contains(lastFocus) && !overlayMode.matches) lastFocus.focus({ preventScroll: true });
  }

  buttons.forEach((b) => b.addEventListener('click', () => (open ? closeAssistant() : openAssistant())));
  $('aiClose').addEventListener('click', () => closeAssistant());
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeAssistant(); }
  });
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('scroll', fit);
  overlayMode.addEventListener('change', fit);

  // ---------- feedback form ----------

  const fbModal = $('feedbackModal');
  let rating = null;
  function setRating(n) {
    rating = n;
    $('feedbackStars').querySelectorAll('[data-star]').forEach((b) => {
      const on = n != null && Number(b.dataset.star) <= n;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(Number(b.dataset.star) === n));
    });
  }
  function openFeedback() {
    $('feedbackForm').reset();
    setRating(null);
    $('feedbackError').textContent = '';
    if (!fbModal.open) fbModal.showModal();
    setTimeout(() => $('feedbackText').focus(), 30);
  }
  $('feedbackStars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-star]');
    if (b) setRating(rating === Number(b.dataset.star) ? null : Number(b.dataset.star));
  });
  $('feedbackOpen').addEventListener('click', openFeedback);
  $('feedbackCancel').addEventListener('click', () => fbModal.close());
  $('feedbackClose').addEventListener('click', () => fbModal.close());
  $('feedbackForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = $('feedbackText').value.trim();
    if (message.length < 2) { $('feedbackError').textContent = 'Please write a few words.'; return; }
    $('feedbackSend').disabled = true;
    try {
      const contact = $('feedbackContact').value.trim();
      await api('POST', '/feedback', { message, ...(rating ? { rating } : {}), ...(contact ? { contact } : {}), client: clientId() });
      fbModal.close();
      showToast?.('Thank you! Your feedback went to the Langrove team.');
    } catch (ex) {
      $('feedbackError').textContent = ex.status ? ex.message : 'Could not send. Check your connection and try again.';
    } finally {
      $('feedbackSend').disabled = false;
    }
  });

  // ---------- hosts: read the feedback ----------

  const inbox = $('inboxModal');
  $('inboxOpen').addEventListener('click', async () => {
    $('authModal')?.close();
    $('inboxList').innerHTML = '';
    $('inboxSummary').textContent = 'Loading…';
    inbox.showModal();
    try {
      const { feedback } = await api('GET', '/feedback');
      const rated = feedback.filter((f) => f.rating);
      const avg = rated.length ? (rated.reduce((a, f) => a + f.rating, 0) / rated.length).toFixed(1) : null;
      $('inboxSummary').textContent = feedback.length
        ? `${feedback.length} message${feedback.length === 1 ? '' : 's'}${avg ? ` · average rating ${avg} of 5 (${rated.length} rated)` : ''}`
        : 'No feedback yet.';
      $('inboxList').innerHTML = feedback.map((f) => `<li><p>${esc(f.message)}</p><div class="inbox-meta">${f.rating ? `<span class="stars-txt">${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}</span> · ` : ''}${esc(new Date(f.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} · ${f.source === 'assistant' ? 'via AI assistant' : 'via form'}${f.contact ? ` · contact: ${esc(f.contact)}` : ''}</div></li>`).join('');
    } catch (ex) {
      $('inboxSummary').textContent = ex.status === 403 ? 'Only hosts can read feedback.' : 'Could not load the feedback. Try again.';
    }
  });
  $('inboxClose').addEventListener('click', () => inbox.close());

  function renderHost() {
    $('inboxOpen').hidden = !store.user?.host;
  }
  store.addEventListener('auth', renderHost);

  // ---------- start ----------

  render();
  renderHost();

  return {
    close: closeAssistant,
    isOpen: () => open,
    docked: () => !overlayMode.matches,
  };
}
