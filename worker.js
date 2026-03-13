const cron = require("node-cron");

console.log("BlueRoute worker started");

/* Worker heartbeat */

cron.schedule("*/5 * * * *", () => {
console.log("Worker heartbeat:", new Date().toISOString());
});