require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl:{rejectUnauthorized:false}
});

/* =========================================================
ADMIN SESSION STORE
========================================================= */

let ADMIN_SESSIONS = {};
const SESSION_TTL = 1000 * 60 * 60 * 2;

/* =========================================================
ADMIN AUTH MIDDLEWARE
========================================================= */

app.use('/api/admin',(req,res,next)=>{

if(req.path === "/login" || req.path === "/session-check"){
return next();
}

const token=req.headers.authorization;

if(!token){
return res.status(403).json({error:"Unauthorized"});
}

const session=ADMIN_SESSIONS[token];

if(!session){
return res.status(403).json({error:"Unauthorized"});
}

if(Date.now() - session.created > SESSION_TTL){
delete ADMIN_SESSIONS[token];
return res.status(403).json({error:"Session expired"});
}

next();

});

/* =========================================================
SYSTEM ROUTES
========================================================= */

app.get('/',(req,res)=>{
res.send('BlueRoute API running');
});

app.get('/health',(req,res)=>{
res.json({status:"ok"});
});

/* =========================================================
ADMIN LOGIN
========================================================= */

app.post("/api/admin/login",(req,res)=>{

const {username,password} = req.body;

if(
username === process.env.ADMIN_USER &&
password === process.env.ADMIN_PASS
){

const token = crypto.randomBytes(32).toString("hex");

ADMIN_SESSIONS[token] = {
created: Date.now()
};

return res.json({
success:true,
token
});

}

res.status(401).json({
success:false,
error:"Invalid credentials"
});

});

/* =========================================================
SESSION CHECK
========================================================= */

app.get("/api/admin/session-check",(req,res)=>{

const token=req.headers.authorization;

const session=ADMIN_SESSIONS[token];

if(!session){
return res.status(403).json({error:"Unauthorized"});
}

if(Date.now() - session.created > SESSION_TTL){
delete ADMIN_SESSIONS[token];
return res.status(403).json({error:"Session expired"});
}

res.json({status:"ok"});

});

/* =========================================================
TRACK SHIPMENT
========================================================= */

app.get('/api/track/:trackingNumber',async(req,res)=>{

const{trackingNumber}=req.params;

try{

const shipmentResult=await pool.query(
'SELECT * FROM shipments WHERE tracking_number=$1',
[trackingNumber]
);

if(shipmentResult.rows.length===0){
return res.status(404).json({found:false});
}

const shipment=shipmentResult.rows[0];

const scansResult=await pool.query(
'SELECT location,remark,scanned_at FROM scan_events WHERE shipment_id=$1 ORDER BY scanned_at DESC',
[shipment.id]
);

res.json({
found:true,
shipment,
scan_history:scansResult.rows
});

}catch(error){
console.error(error);
res.status(500).json({error:'Server error'});
}

});

/* =========================================================
CREATE SHIPMENT
========================================================= */

app.post('/api/admin/create-shipment',async(req,res)=>{

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

try{

const trackingNumber='BR'+Date.now()+Math.floor(Math.random()*1000);

const shipmentInsert=await pool.query(
`INSERT INTO shipments
(
tracking_number,
sender_name,
sender_address,
sender_phone,
sender_email,
receiver_name,
receiver_address,
receiver_phone,
receiver_email,
origin,
destination,
shipment_name,
weight,
items_sent,
box_count,
sent_date,
estimated_delivery,
remarks,
status,
last_updated
)
VALUES(
$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
$11,$12,$13,$14,$15,$16,$17,$18,
$19,NOW()
)
RETURNING id`,
[
trackingNumber,
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
remarks,
'Shipment Created'
]
);

const shipmentId=shipmentInsert.rows[0].id;

await pool.query(
`INSERT INTO scan_events (shipment_id,location,remark,scanned_at)
VALUES($1,$2,$3,NOW())`,
[shipmentId,origin,'Shipment Created']
);

res.json({
success:true,
trackingNumber
});

}catch(error){

console.error("Create shipment error:",error);

res.status(500).json({success:false});

}

});

/* =========================================================
UPDATE SHIPMENT STATUS
========================================================= */

app.post('/api/admin/update-shipment', async (req,res)=>{

const {trackingNumber,status} = req.body;

try{

const shipment = await pool.query(
'SELECT id FROM shipments WHERE tracking_number=$1',
[trackingNumber]
);

if(shipment.rows.length === 0){
return res.json({success:false});
}

const shipmentId = shipment.rows[0].id;

await pool.query(
'UPDATE shipments SET status=$1, last_updated=NOW() WHERE id=$2',
[status, shipmentId]
);

await pool.query(
'INSERT INTO scan_events (shipment_id,location,remark,scanned_at) VALUES($1,$2,$3,NOW())',
[shipmentId,status,status]
);

res.json({success:true});

}catch(error){

console.error("Update shipment error:",error);

res.status(500).json({success:false});

}

});

/* =========================================================
ADMIN SHIPMENT LIST
========================================================= */

app.get('/api/admin/shipments', async (req,res)=>{

try{

const result = await pool.query(`
SELECT
tracking_number AS tracking,
origin,
destination,
status
FROM shipments
ORDER BY id DESC
`);

res.json(result.rows);

}catch(error){

console.error("Shipment list error:", error);

res.status(500).json({error:"Failed"});

}

});

const PORT=process.env.PORT||3000;

app.listen(PORT,()=>{
console.log(`Server running on port ${PORT}`);
});