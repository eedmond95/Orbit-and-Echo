// Shared HTTP contract; storage is supplied by the Netlify function.
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
};
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS });

export function createLeaderboardHandler(store, logger = console) {
  return async function leaderboard(req) {
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
      if (req.method === 'GET') return json(await store.topScores());
      if (req.method !== 'POST') {
        return new Response('Method not allowed', {
          status: 405, headers: { ...HEADERS, Allow: 'GET, POST, OPTIONS' },
        });
      }

      let body;
      try { body = await req.json(); }
      catch { return json({ error: 'Invalid JSON' }, 400); }
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 20 || !/^[\p{L}\p{N} _.\-]+$/u.test(name)) {
        return json({ error: 'Use 1–20 letters, numbers, spaces, dots, underscores or hyphens' }, 400);
      }
      if (!Number.isSafeInteger(body.score) || body.score <= 0 || body.score > 50_000_000) {
        return json({ error: 'Invalid score' }, 400);
      }
      if (!Number.isSafeInteger(body.level) || body.level < 1 || body.level > 999) {
        return json({ error: 'Invalid level' }, 400);
      }
      const entry = await store.insertScore({ name, score: body.score, level: body.level });
      return json({ id: entry.id, top: await store.topScores() }, 201);
    } catch (_) {
      // Avoid exposing database connection details in responses or logs.
      logger.error('Leaderboard storage request failed');
      return json({ error: 'Leaderboard temporarily unavailable' }, 503);
    }
  };
}
