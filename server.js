require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test route
app.get('/', (req, res) => {
  res.send('BlueRoute API is running 🚀');
});

// Database test route
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      connected: true,
      time: result.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      connected: false,
      error: error.message
    });
  }
});

// Track shipment
app.get('/api/track/:trackingNumber', async (req, res) => {
  const { trackingNumber } = req.params;

  try {
    const shipmentResult = await pool.query(
      'SELECT * FROM shipments WHERE tracking_number = $1',
      [trackingNumber]
    );

    if (shipmentResult.rows.length === 0) {
      return res.status(404).json({ found: false });
    }

    const shipment = shipmentResult.rows[0];

    const scansResult = await pool.query(
      'SELECT location, remark, scanned_at FROM scan_events WHERE shipment_id = $1 ORDER BY scanned_at DESC',
      [shipment.id]
    );

    res.json({
      found: true,
      shipment,
      scan_history: scansResult.rows
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start server (RAILWAY UPGRADE ONLY)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});