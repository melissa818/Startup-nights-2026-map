// POST /visitors · callers: ["*"] · input: [{ name: "email", type: "string", required: true }]
// Register a visitor email so the one-time sign-in code can be sent to it.
async function handler(ctx) {
  const email = String(ctx.body.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    ctx.badRequest('Please enter a valid email address.');
  }
  // Sign-up runs before anybody is signed in, so the lookup and insert are unfenced.
  const existing = await ctx.db.Visitor.list({ where: { email }, limit: 1, policy: false });
  if (existing.length === 0) {
    try {
      await ctx.db.Visitor.insert({ email }, { policy: false });
    } catch (e) {
      // A concurrent registration of the same email hit the unique index; that is fine.
      const again = await ctx.db.Visitor.list({ where: { email }, limit: 1, policy: false });
      if (again.length === 0) throw e;
    }
  }
  // Same answer either way, so this endpoint cannot be used to discover who registered.
  return ctx.ok({ email });
}
