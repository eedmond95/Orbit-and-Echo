import type { Config } from "@netlify/functions";
import { desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { scores } from "../../db/schema.js";

const TOP_N = 50;
// Sanity cap so obviously forged submissions don't take over the board
const MAX_SCORE = 50_000_000;

async function topScores() {
  return db
    .select({
      id: scores.id,
      name: scores.name,
      score: scores.score,
      level: scores.level,
      createdAt: scores.createdAt,
    })
    .from(scores)
    .orderBy(desc(scores.score), scores.createdAt)
    .limit(TOP_N);
}

// The game page may be hosted elsewhere (GitHub Pages, itch.io, a local file...),
// so the API must accept cross-origin requests
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method === "GET") {
    return Response.json(await topScores(), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const name = String(body?.name ?? "")
      .replace(/[^\p{L}\p{N} _.\-]/gu, "")
      .trim()
      .slice(0, 16);
    const score = Math.floor(Number(body?.score));
    const level = Math.floor(Number(body?.level));

    if (!name) return Response.json({ error: "Name is required" }, { status: 400 });
    if (!Number.isFinite(score) || score <= 0 || score > MAX_SCORE) {
      return Response.json({ error: "Invalid score" }, { status: 400 });
    }

    const [entry] = await db
      .insert(scores)
      .values({ name, score, level: Number.isFinite(level) && level > 0 ? Math.min(level, 999) : 1 })
      .returning({ id: scores.id });

    return Response.json({ id: entry.id, top: await topScores() }, { status: 201 });
  }

  return new Response("Method not allowed", { status: 405 });
}

export default async (req: Request) => {
  let res: Response;
  try {
    res = await handle(req);
  } catch (err) {
    console.error(err);
    res = Response.json({ error: "Server error" }, { status: 500 });
  }
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
};

export const config: Config = {
  path: "/api/leaderboard",
};
