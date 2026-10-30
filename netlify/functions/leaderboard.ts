import type { Config } from '@netlify/functions';
import { desc } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { scores } from '../../db/schema.js';
import { createLeaderboardHandler } from '../lib/leaderboard.mjs';

export default createLeaderboardHandler({
  topScores: () => getDb().select({
    id: scores.id,
    name: scores.name,
    score: scores.score,
    level: scores.level,
    createdAt: scores.createdAt,
  }).from(scores).orderBy(desc(scores.score), scores.createdAt, scores.id).limit(50),
  insertScore: async (entry) => {
    const [saved] = await getDb().insert(scores).values(entry).returning({ id: scores.id });
    return saved;
  },
});

export const config: Config = { path: '/api/leaderboard' };
