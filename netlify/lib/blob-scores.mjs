import { randomUUID } from 'node:crypto';

const KEY = 'top-50';
const rank = (a, b) => b.score - a.score
  || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

// A site-scoped store survives deployments. Conditional writes prevent concurrent
// submissions from overwriting each other; only the public top 50 are retained.
export function createBlobScoreStore(getStore) {
  return {
    async topScores() {
      return (await getStore().get(KEY, { type: 'json' })) ?? [];
    },
    async insertScore({ runId, ...score }) {
      const entry = { ...score, id: runId ?? randomUUID(), createdAt: new Date().toISOString() };
      const store = getStore();
      for (let attempt = 0; attempt < 12; attempt++) {
        const snapshot = await store.getWithMetadata(KEY, { type: 'json' });
        const entries = snapshot?.data ?? [];
        const existing = entries.find(row => row.id === entry.id);
        if (existing) return existing;
        const top = [...entries, entry].sort(rank).slice(0, 50);
        if (!top.some(row => row.id === entry.id)) return entry;
        if (snapshot && !snapshot.etag) throw new Error('Missing leaderboard version');
        const condition = snapshot ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true };
        const result = await store.setJSON(KEY, top, condition);
        if (result.modified) return entry;
      }
      throw new Error('Leaderboard is busy; retry this run');
    },
  };
}
