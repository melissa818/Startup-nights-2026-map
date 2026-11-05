// DELETE /sessions/current · callers: ["Visitor"]
// Sign the current visitor out of the booth map.
async function handler(ctx) {
  return ctx.auth.logout(ctx.noContent());
}
