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

// 🔥 HEALTH CHECK ENDPOINT (ADDED - NO OTHER CODE CHANGED)
app.get('/health', (req, res) => {
  res.json({ status: "ok" });
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

/* =========================================================
   🔥 NEW ADMIN CREATE SHIPMENT ENDPOINT (UPGRADED)
   ========================================================= */

app.post('/api/admin/create-shipment', async (req, res) => {

  // 🔐 ADMIN SECRET PROTECTION (ADDED)
  if (req.headers.authorization !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const {
    senderName,
    senderAddress,
    senderPhone,
    senderEmail,
    receiverName,
    receiverAddress,
    receiverPhone,
    receiverEmail,
    origin,
    destination,
    shipmentName,
    weight,
    itemsSent,
    boxCount,
    sentDate,
    estimatedDelivery,
    remarks
  } = req.body;

  try {

    // ✅ INPUT VALIDATION (ADDED)
    if (!origin || !destination) {
      return res.status(400).json({ error: "Origin and destination required" });
    }

    // Generate tracking number
    const trackingNumber = 'BR' + Date.now();

    // Insert into shipments table
    const shipmentInsert = await pool.query(
      `INSERT INTO shipments 
      (tracking_number, origin, destination, status, last_updated)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id`,
      [trackingNumber, origin, destination, 'Shipment Created']
    );

    const shipmentId = shipmentInsert.rows[0].id;

    // Insert first scan event
    await pool.query(
      `INSERT INTO scan_events (shipment_id, location, remark, scanned_at)
       VALUES ($1, $2, $3, NOW())`,
      [shipmentId, origin, 'Shipment Created']
    );

    res.json({
      success: true,
      trackingNumber
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: 'Failed to create shipment'
    });
  }
});

// Start server (RAILWAY UPGRADE ONLY)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});