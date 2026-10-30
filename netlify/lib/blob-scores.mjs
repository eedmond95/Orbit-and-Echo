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
        // A saved callsign can change after automatic submission. A revived run
        // may also finish with more points. Never let a delayed lower score undo it.
        if (existing && (existing.score > entry.score
            || (existing.score === entry.score && existing.name === entry.name))) return existing;
        const updated = existing ? { ...entry, createdAt: existing.createdAt } : entry;
        const top = [...entries.filter(row => row.id !== entry.id), updated].sort(rank).slice(0, 50);
        if (!top.some(row => row.id === entry.id)) return entry;
        if (snapshot && !snapshot.etag) throw new Error('Missing leaderboard version');
        const condition = snapshot ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true };
        const result = await store.setJSON(KEY, top, condition);
        if (result.modified) return updated;
      }
      throw new Error('Leaderboard is busy; retry this run');
    },
  };
}
