import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema.js";

const createDb = () => drizzle({ schema });
let database: ReturnType<typeof createDb>;

// Initialize inside the request so missing database configuration gets a JSON/CORS error.
export function getDb() {
  return database ??= createDb();
}
