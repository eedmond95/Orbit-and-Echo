import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLeaderboardHandler } from '../netlify/lib/leaderboard.mjs';
import { createBlobScoreStore } from '../netlify/lib/blob-scores.mjs';

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
    { score: -1 }, { score: 50_000_001 }, { score: 1.5 }, { score: '100' },
    { level: 0 }, { level: 1000 }, { level: 1.5 },
    { runId: '../bad-path' }, { runId: 12 },
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

test('automatically submitted zero-point runs are accepted', async () => {
  const { handler } = fixture();
  assert.equal((await handler(request('POST', { ...run, score: 0 }))).status, 201);
});

test('storage failures still include CORS headers and no private error details', async () => {
  const handler = createLeaderboardHandler({ topScores: () => { throw new Error('private connection string'); } }, { error() {} });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.doesNotMatch(await response.text(), /private/);
});

function blobFixture() {
  let data = null;
  let version = 0;
  const store = {
    get: async () => structuredClone(data),
    getWithMetadata: async () => data === null ? null : { data: structuredClone(data), etag: String(version) },
    setJSON: async (_, next, condition) => {
      if (condition.onlyIfNew && data !== null) return { modified: false };
      if (condition.onlyIfMatch !== undefined && condition.onlyIfMatch !== String(version)) return { modified: false };
      data = structuredClone(next);
      version++;
      return { modified: true, etag: String(version) };
    },
  };
  return { store, scores: createBlobScoreStore(() => store) };
}

test('built-in storage starts empty and retains scores across handler instances', async () => {
  const { store, scores } = blobFixture();
  assert.deepEqual(await scores.topScores(), []);
  await scores.insertScore(run);
  const second = createBlobScoreStore(() => store);
  assert.equal((await second.topScores())[0].score, run.score);
});

test('built-in storage preserves concurrent submissions using conditional writes', async () => {
  const { scores } = blobFixture();
  await Promise.all(Array.from({ length: 8 }, (_, index) => scores.insertScore({ ...run, score: index + 1 })));
  assert.deepEqual((await scores.topScores()).map(row => row.score), [8, 7, 6, 5, 4, 3, 2, 1]);
});

test('repeating the same run ID does not create another leaderboard entry', async () => {
  const { scores } = blobFixture();
  const entry = { ...run, runId: '6fe9a17c-a001-4be3-8896-ce2c9f0b01aa' };
  await Promise.all([scores.insertScore(entry), scores.insertScore(entry)]);
  assert.equal((await scores.topScores()).length, 1);
  assert.equal((await scores.topScores())[0].id, entry.runId);
});

test('editing an automatic callsign updates the same row and preserves its timestamp', async () => {
  const { scores } = blobFixture();
  const entry = { ...run, runId: '6fe9a17c-a001-4be3-8896-ce2c9f0b01aa' };
  const first = await scores.insertScore(entry);
  await scores.insertScore({ ...entry, name: 'Chosen Name' });
  const top = await scores.topScores();
  assert.equal(top.length, 1);
  assert.equal(top[0].name, 'Chosen Name');
  assert.equal(top[0].createdAt, first.createdAt);
});

test('revived runs replace their earlier score and delayed lower scores cannot undo it', async () => {
  const { scores } = blobFixture();
  const entry = { ...run, runId: '6fe9a17c-a001-4be3-8896-ce2c9f0b01aa' };
  await scores.insertScore(entry);
  await scores.insertScore({ ...entry, score: 2500, level: 3, name: 'Final Name' });
  await scores.insertScore(entry);
  const top = await scores.topScores();
  assert.equal(top.length, 1);
  assert.equal(top[0].score, 2500);
  assert.equal(top[0].level, 3);
  assert.equal(top[0].name, 'Final Name');
});

test('built-in storage keeps only the top 50 and does not overwrite them with a lower score', async () => {
  const { scores } = blobFixture();
  for (let score = 1; score <= 55; score++) await scores.insertScore({ ...run, score });
  await scores.insertScore({ ...run, score: 1 });
  const top = await scores.topScores();
  assert.equal(top.length, 50);
  assert.equal(top[0].score, 55);
  assert.equal(top.at(-1).score, 6);
});

test('repeated storage conflicts fail safely rather than performing an unconditional overwrite', async () => {
  let writes = 0;
  const scores = createBlobScoreStore(() => ({
    getWithMetadata: async () => null,
    setJSON: async () => { writes++; return { modified: false }; },
  }));
  await assert.rejects(scores.insertScore(run), /busy/);
  assert.equal(writes, 12);
});
