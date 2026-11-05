// POST /assistant/messages · callers: ["*"]
// input: message (string, required), history (object: { turns: [{ role, text }] }), client (string)
// Ask the booth map's AI assistant (anyone, no sign-in): where a startup, booth or place is, what a
// startup does, or send feedback. Answers text plus the startups and places to show on the map.
// Questions are not stored; only when they were asked (AssistantUse), to limit usage.
async function handler(ctx) {
  const message = String(ctx.body.message || '').replace(/\s+/g, ' ').trim();
  if (!message) ctx.badRequest('Ask a question.');
  if (message.length > 500) ctx.badRequest('Please keep it under 500 characters.');
  const client = /^[A-Za-z0-9-]{8,64}$/.test(String(ctx.body.client || '')) ? String(ctx.body.client) : '';
  const now = Date.now();

  // Limits keep the AI bill of a free, public demo bounded. Counting needs every row (AssistantUse.read admits nobody).
  const LIMIT_ALL_MIN = 60, LIMIT_CLIENT_MIN = 10, LIMIT_CLIENT_DAY = 200;
  const busy = (detail) => ctx.json(429, { error: 'Too many questions', detail });
  const lastMinute = await ctx.db.AssistantUse.list({ where: { kind: 'question', created_at: { gt: now - 60000 } }, limit: LIMIT_ALL_MIN, policy: false });
  if (lastMinute.length >= LIMIT_ALL_MIN) return busy('Lots of people are asking right now. Please try again in a minute.');
  if (client) {
    if (lastMinute.filter((u) => u.client === client).length >= LIMIT_CLIENT_MIN) return busy('That was a lot of questions in a row. Please wait a minute.');
    const today = await ctx.db.AssistantUse.list({ where: { kind: 'question', client, created_at: { gt: now - 86400000 } }, limit: LIMIT_CLIENT_DAY, policy: false });
    if (today.length >= LIMIT_CLIENT_DAY) return busy('You reached today\'s limit for this demo. Thanks for trying it!');
  }
  let visitor = null;
  if (ctx.principal) {
    const me = await ctx.db.Visitor.get(ctx.principal).catch(() => null);
    if (me) visitor = me.id;
  }
  await ctx.db.AssistantUse.insert({ client, kind: 'question', created_at: now, ...(visitor ? { visitor } : {}) }, { policy: false });

  const turns = ctx.body.history && Array.isArray(ctx.body.history.turns) ? ctx.body.history.turns : [];
  const history = turns.slice(-8)
    .map((t) => ({ role: t && t.role === 'assistant' ? 'assistant' : 'user', text: String((t && t.text) || '').slice(0, 800) }))
    .filter((t) => t.text);

  let out;
  try {
    out = await ctx.agents.run('booth_assistant', { message, history }, { budgetMs: 12500 });
  } catch (e) {
    let why = '';
    try { why = (e && e.message) || JSON.stringify(e); } catch (x) { why = String(e); }
    ctx.log.warn('assistant unavailable', { name: 'assistant.error', error: String(why).slice(0, 300) });
    return ctx.json(503, { error: 'Assistant unavailable', detail: 'The AI assistant is not available right now.' });
  }
  if (out && out.error) {
    ctx.log.warn('assistant failed', { name: 'assistant.error', error: String(out.error).slice(0, 300) });
    return ctx.json(503, { error: 'Assistant unavailable', detail: 'The AI assistant took too long. Please try again.' });
  }

  // The agent ends with the `answer` tool; find its result whatever envelope the run returns.
  const find = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 4) return null;
    if (typeof o.text === 'string' && Array.isArray(o.startups)) return o;
    for (const k of Object.keys(o)) {
      const r = find(o[k], depth + 1);
      if (r) return r;
    }
    return null;
  };
  let res = find(out);
  if (!res) {
    const text = typeof out === 'string' ? out : (out && (out.text || out.output || out.answer)) || '';
    res = { text: String(text), startups: [], places: [], feedback_saved: false };
  }
  return ctx.ok({
    text: String(res.text || '').trim() || 'Sorry, I could not answer that. Try asking about a startup, a booth number or a place.',
    startups: (res.startups || []).slice(0, 6),
    places: (res.places || []).slice(0, 3),
    feedback_saved: res.feedback_saved === true,
  });
}
