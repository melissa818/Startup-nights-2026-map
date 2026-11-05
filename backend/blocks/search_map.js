// Block search_map · input: [{ name: "query", type: "string", required: true }]
// Search the Startup Nights 2026 floor plan: startups by name, booth number, category or topic,
// and places (stages, workshops, bars, food, toilets, entrance, exits). Answers where each is.
// Reads site/data/assistant.json (built by tools/build_assistant_data.py) from the app's own site.
async function block(input, ctx) {
  const query = String((input && input.query) || '').trim().slice(0, 200);
  if (!query) return { startups: [], places: [], note: 'Give a name, booth number, topic or place to search for.' };

  // The directory is published with the site (site/data/assistant.json, built from the booth list).
  const r = await ctx.http.get(ctx.url('/data/assistant.json'));
  if (!r.ok) throw new Error(`The booth directory could not be loaded (${r.status}).`);
  const d = r.json();

  const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const STOP = new Set(('where is are the a an booth booths stand stands of find me show which what who at in on for to startup startups ' +
    'company companies and or with do does i can there any near nearest closest how get go please tell about number no nr ' +
    'located location place places i\'m im looking look want see visit some all list').split(' '));
  const q = fold(query);
  const words = q.split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
  const nums = (q.match(/\b\d{1,3}\b/g) || []).map((n) => n.padStart(3, '0'));
  const boothNums = (label) => String(label || '').split(/,\s*/).flatMap((part) => {
    const [a, b] = part.split('–').map(Number);
    const out = [];
    for (let i = a; i <= (b || a); i++) out.push(String(i).padStart(3, '0'));
    return out;
  });

  const scored = (list, fields) => list.map((item) => {
    const name = fold(item.name);
    const other = fold(fields(item));
    let score = 0;
    if (item.booth && nums.some((n) => boothNums(item.booth).includes(n))) score += 100;
    if (words.length && name === words.join(' ')) score += 80;
    for (const w of words) {
      if (name.split(/[^a-z0-9]+/).includes(w)) score += 40;
      else if (w.length >= 3 && name.includes(w)) score += 25;
      else if (w.length >= 3 && other.includes(w)) score += 6;
    }
    return { item, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);

  const startups = scored(d.startups, (s) => `${s.category} ${s.about}`).slice(0, 8).map(({ item: s }) => ({
    id: s.id, name: s.name, booth: s.booth, category: s.category, about: s.about,
    website: s.website || null, where: s.where, near: s.near, details_verified: s.verified,
  }));
  const places = scored(d.places, (p) => `${p.kind} ${p.words}`).slice(0, 5).map(({ item: p }) => ({
    id: p.id, name: p.name, kind: p.kind, how_many: p.count, where: p.where,
  }));
  return {
    startups,
    places,
    orientation: d.orientation,
    note: startups.length || places.length ? undefined : 'No match. Try another spelling, a booth number or a topic.',
  };
}
