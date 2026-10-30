import type { Config } from '@netlify/functions';
import { desc } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { scores } from '../../db/schema.js';
import { createLeaderboardHandler } from '../lib/leaderboard.mjs';
import { getStore } from '@netlify/blobs';
import { createBlobScoreStore } from '../lib/blob-scores.mjs';

// Existing database users keep their scores. New deployments use built-in Blobs:
// Netlify injects the storage credentials; no database or API-key setup is needed.
const databaseScores = {
  topScores: () => getDb().select({
    id: scores.id,
    name: scores.name,
    score: scores.score,
    level: scores.level,
    createdAt: scores.createdAt,
  }).from(scores).orderBy(desc(scores.score), scores.createdAt, scores.id).limit(50),
  insertScore: async (entry) => {
    const { name, score, level } = entry;
    const [saved] = await getDb().insert(scores).values({ name, score, level }).returning({ id: scores.id });
    return saved;
  },
};
const blobScores = createBlobScoreStore(() => getStore({
  name: 'orbit-echo-leaderboard', consistency: 'strong',
}));
const store = () => process.env.NETLIFY_DB_URL ? databaseScores : blobScores;
export default createLeaderboardHandler({
  topScores: () => store().topScores(),
  insertScore: entry => store().insertScore(entry),
});

export const config: Config = { path: '/api/leaderboard' };
