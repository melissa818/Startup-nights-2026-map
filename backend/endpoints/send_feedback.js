// POST /feedback · callers: ["*"]
// input: message (string, required), rating (number 1-5), contact (string), client (string)
// Send feedback about the booth map to the Langrove team (anyone, no sign-in). Stored privately;
// only hosts can read it.
async function handler(ctx) {
  const message = String(ctx.body.message || '').replace(/\s+/g, ' ').trim();
  if (message.length < 2) ctx.badRequest('Please write a few words.');
  if (message.length > 2000) ctx.badRequest('Please keep it under 2000 characters.');
  const rating = ctx.body.rating == null ? null : Number(ctx.body.rating);
  if (rating != null && !(rating >= 1 && rating <= 5)) ctx.badRequest('Rating must be 1 to 5.');
  const contact = String(ctx.body.contact || '').trim().slice(0, 200);
  const client = /^[A-Za-z0-9-]{8,64}$/.test(String(ctx.body.client || '')) ? String(ctx.body.client) : '';
  const now = Date.now();

  // Spam brakes: 30 a minute overall, 5 per 10 minutes per browser.
  const recent = await ctx.db.AssistantUse.list({ where: { kind: 'feedback', created_at: { gt: now - 600000 } }, limit: 300, policy: false });
  if (recent.filter((u) => u.created_at > now - 60000).length >= 30 || (client && recent.filter((u) => u.client === client).length >= 5)) {
    return ctx.json(429, { error: 'Too much feedback', detail: 'Thanks! Please wait a few minutes before sending more.' });
  }

  let visitor = null;
  if (ctx.principal) {
    const me = await ctx.db.Visitor.get(ctx.principal).catch(() => null);
    if (me) visitor = me.id;
  }
  await ctx.db.AssistantUse.insert({ client, kind: 'feedback', created_at: now, ...(visitor ? { visitor } : {}) }, { policy: false });
  // Write-only for visitors (feedback.create admits nobody); hosts read it via GET /feedback.
  await ctx.db.Feedback.insert({
    message, rating: rating == null ? null : Math.round(rating), contact, source: 'form', created_at: now, ...(visitor ? { visitor } : {}),
  }, { policy: false });
  ctx.log('feedback saved', { name: 'feedback.saved', source: 'form' });
  return ctx.created({ saved: true });
}
