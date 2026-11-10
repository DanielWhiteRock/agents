// Throwaway schema reset, for running the integration suite against Postgres.
import { Pool } from "pg";
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const pool = new Pool({ connectionString: url });
await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
await pool.end();
console.log("schema reset");
