require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
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

/* =========================================================
ADMIN AUTH MIDDLEWARE
========================================================= */

app.use('/api/admin',(req,res,next)=>{

if(req.path === "/login"){
return next();
}

const token=req.headers.authorization;

if(!token){
return res.status(403).json({error:"Unauthorized"});
}

if(ADMIN_SESSIONS[token]){
return next();
}

return res.status(403).json({error:"Unauthorized"});

});

/* =========================================================
EMAIL SYSTEM
========================================================= */

const mailer = nodemailer.createTransport({
service:"gmail",
auth:{
user:process.env.EMAIL_USER,
pass:process.env.EMAIL_PASS
}
});

async function sendShipmentEmail(data){

try{

const link=`${process.env.PUBLIC_TRACKING_URL}/tracking.html?track=${data.trackingNumber}`;

if(data.senderEmail){
await mailer.sendMail({
from:`"BlueRoute Express" <${process.env.EMAIL_USER}>`,
to:data.senderEmail,
subject:`Shipment Created — ${data.trackingNumber}`,
html:`
<h2>Shipment Created</h2>
<p>Hello ${data.senderName || "Customer"},</p>

<p>Your shipment has been created.</p>

<p><strong>Tracking Number:</strong> ${data.trackingNumber}</p>
<p><strong>Route:</strong> ${data.origin} → ${data.destination}</p>

<p>Track here:</p>
<a href="${link}">${link}</a>
`
});
}

}catch(err){
console.error("Email failed:",err);
}

}

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

const token = req.headers.authorization;

if(!token || !ADMIN_SESSIONS[token]){
return res.status(403).json({error:"Unauthorized"});
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

const{
senderName,
senderEmail,
receiverName,
receiverEmail,
origin,
destination
}=req.body;

try{

const trackingNumber='BR'+Date.now();

const shipmentInsert=await pool.query(
`INSERT INTO shipments
(tracking_number,origin,destination,status,last_updated)
VALUES($1,$2,$3,$4,NOW())
RETURNING id`,
[trackingNumber,origin,destination,'Shipment Created']
);

const shipmentId=shipmentInsert.rows[0].id;

await pool.query(
`INSERT INTO scan_events (shipment_id,location,remark,scanned_at)
VALUES($1,$2,$3,NOW())`,
[shipmentId,origin,'Shipment Created']
);

sendShipmentEmail({
trackingNumber,
senderName,
senderEmail,
receiverName,
receiverEmail,
origin,
destination
});

res.json({
success:true,
trackingNumber
});

}catch(error){
console.error(error);
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

res.status(500).json({
error:"Failed",
details:error.message
});

}

});

const PORT=process.env.PORT||3000;

app.listen(PORT,()=>{
console.log(`Server running on port ${PORT}`);
});