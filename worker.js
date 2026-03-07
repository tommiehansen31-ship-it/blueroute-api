const cron = require("node-cron");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

console.log("BlueRoute worker started");

// Runs every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  console.log("Running shipment update job");

  try {
    const result = await pool.query(`
      UPDATE shipments
      SET last_updated = NOW()
      WHERE archived = false
    `);

    console.log("Shipments checked:", result.rowCount);
  } catch (err) {
    console.error("Worker error:", err);
  }
});