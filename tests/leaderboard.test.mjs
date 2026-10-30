import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLeaderboardHandler } from '../netlify/lib/leaderboard.mjs';

function fixture() {
  const rows = [];
  const handler = createLeaderboardHandler({
    topScores: async () => [...rows].sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 50),
    insertScore: async (entry) => {
      const row = { id: rows.length + 1, ...entry };
      rows.push(row);
      return row;
    },
  });
  return { handler, rows };
}
const request = (method = 'GET', body) => new Request('https://game.netlify.app/api/leaderboard', {
  method, headers: { Origin: 'https://eedmond95.github.io', 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const run = { name: 'Lyra Pilot', score: 1200, level: 2 };

test('GitHub Pages cross-origin preflight succeeds', async () => {
  const { handler } = fixture();
  const response = await handler(request('OPTIONS'));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  assert.match(response.headers.get('access-control-allow-headers'), /Content-Type/);
});

test('scores can be posted, ranked, and read from a different request', async () => {
  const { handler } = fixture();
  let response = await handler(request('POST', run));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, 1);
  response = await handler(request('POST', { ...run, name: 'Second Pilot', score: 2000 }));
  const submitted = await response.json();
  assert.equal(submitted.id, 2);
  assert.equal(submitted.top[0].name, 'Second Pilot');
  response = await handler(request());
  assert.deepEqual((await response.json()).map(row => row.score), [2000, 1200]);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

test('accepts the UI limit of 20 characters and Unicode callsigns', async () => {
  const { handler } = fixture();
  assert.equal((await handler(request('POST', { ...run, name: 'A'.repeat(20) }))).status, 201);
  assert.equal((await handler(request('POST', { ...run, name: '  Lýra 星  ' }))).status, 201);
});

test('rejects invalid submissions without saving them', async () => {
  const { handler, rows } = fixture();
  for (const changes of [
    { name: '' }, { name: 'A'.repeat(21) }, { name: '<script>' }, { name: 123 },
    { score: -1 }, { score: 0 }, { score: 50_000_001 }, { score: 1.5 }, { score: '100' },
    { level: 0 }, { level: 1000 }, { level: 1.5 },
  ]) {
    const response = await handler(request('POST', { ...run, ...changes }));
    assert.equal(response.status, 400, JSON.stringify(changes));
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  }
  assert.equal(rows.length, 0);
});

test('bad JSON and unsupported methods get explicit errors', async () => {
  const { handler } = fixture();
  const broken = new Request('https://game.netlify.app/api/leaderboard', { method: 'POST', body: '{broken' });
  assert.equal((await handler(broken)).status, 400);
  assert.equal((await handler(request('DELETE'))).status, 405);
});

test('storage failures still include CORS headers and no private error details', async () => {
  const handler = createLeaderboardHandler({ topScores: () => { throw new Error('private connection string'); } }, { error() {} });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.doesNotMatch(await response.text(), /private/);
});
