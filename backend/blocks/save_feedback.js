// Block save_feedback · input: message (string, required), rating (number), contact (string)
// Save feedback about the booth map and AI assistant for the Langrove team. The agent only calls
// it when the person clearly wants to send this feedback.
async function block(input, ctx) {
  const message = String((input && input.message) || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (message.length < 2) return { saved: false, reason: 'The feedback is empty.' };
  const rating = Number(input.rating);
  const row = {
    message,
    rating: rating >= 1 && rating <= 5 ? Math.round(rating) : null,
    contact: String(input.contact || '').trim().slice(0, 200),
    source: 'assistant',
    created_at: Date.now(),
  };
  // Link it to the visitor's account when they are signed in, so it goes if they delete their account.
  if (ctx.principal) {
    const me = await ctx.db.Visitor.get(ctx.principal).catch(() => null);
    if (me) row.visitor = me.id;
  }
  // Feedback is write-only for visitors (feedback.create admits nobody); only hosts read it, via GET /feedback.
  await ctx.db.Feedback.insert(row, { policy: false });
  ctx.log('feedback saved', { name: 'feedback.saved', source: 'assistant' });
  return { saved: true };
}
