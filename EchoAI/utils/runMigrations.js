require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");

/**
 * Applies all SQL migrations in models/ in filename order. Each applied
 * migration is recorded in a `schema_migrations` table so re-runs are
 * idempotent (already-applied files are skipped). Designed to be run as part of
 * the production start sequence (`npm run migrate`).
 *
 * Migrations must be individually safe to apply once; use IF NOT EXISTS in the
 * SQL where possible so a partially-migrated database can be brought forward.
 */
async function runMigrations() {
  const modelsDir = path.join(__dirname, "..", "models");
  const files = fs
    .readdirSync(modelsDir)
    .filter((f) => f.endsWith(".sql") && f !== "schema.sql")
    .sort();

  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );

    const applied = new Set(
      (await client.query("SELECT filename FROM schema_migrations")).rows.map(
        (r) => r.filename,
      ),
    );

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`= skip ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(modelsDir, file), "utf8");
      // Each migration runs in its own transaction. Migration SQL is written to
      // be idempotent (CREATE TABLE/INDEX ... IF NOT EXISTS, etc.) so applying
      // it against an already-migrated database is a safe no-op. A genuine
      // failure aborts the whole run rather than silently marking the file
      // applied and leaving schema drift.
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
          [file],
        );
        await client.query("COMMIT");
        console.log(`+ applied ${file}`);
        count += 1;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(
          `Migration ${file} failed: ${err.message}. ` +
            "Ensure the migration SQL is idempotent (use IF NOT EXISTS).",
        );
      }
    }

    console.log(
      `Migrations complete: ${count} applied, ${files.length - count} skipped.`,
    );
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration run failed:", err.message);
      process.exit(1);
    });
}

module.exports = { runMigrations };
