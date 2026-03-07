require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl:{rejectUnauthorized:false}
});

/* =========================================================
ADMIN AUTH MIDDLEWARE
========================================================= */

app.use('/api/admin',(req,res,next)=>{
if(req.headers.authorization!==process.env.ADMIN_SECRET){
return res.status(403).json({error:"Unauthorized"});
}
next();
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

if(data.receiverEmail){
await mailer.sendMail({
from:`"BlueRoute Express" <${process.env.EMAIL_USER}>`,
to:data.receiverEmail,
subject:`Shipment Incoming — ${data.trackingNumber}`,
html:`
<h2>Shipment On The Way</h2>

<p>Hello ${data.receiverName || "Customer"},</p>

<p>A shipment is on the way to you.</p>

<p><strong>Tracking Number:</strong> ${data.trackingNumber}</p>

<p>Track shipment:</p>
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
res.send('BlueRoute API is running 🚀');
});

app.get('/health',(req,res)=>{
res.json({status:"ok"});
});

app.get('/healthz',(req,res)=>{
res.status(200).send("OK");
});

app.get('/api/test-db',async(req,res)=>{
try{
const result=await pool.query('SELECT NOW()');
res.json({connected:true,time:result.rows[0]});
}catch(error){
console.error(error);
res.status(500).json({connected:false,error:error.message});
}
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

if(!origin||!destination){
return res.status(400).json({error:"Origin and destination required"});
}

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

/* EMAIL NOTIFICATION */
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
res.status(500).json({
success:false,
error:'Failed to create shipment'
});
}

});

/* =========================================================
ADMIN SHIPMENT LIST
========================================================= */

app.get('/api/admin/shipments',async(req,res)=>{

try{

const result=await pool.query(`
SELECT
tracking_number AS tracking,
status,
origin,
destination,
last_updated
FROM shipments
WHERE archived=FALSE
ORDER BY last_updated DESC
`);

res.json(result.rows);

}catch(error){
console.error(error);
res.status(500).json({error:'Failed to load shipments'});
}

});

/* =========================================================
UPDATE SHIPMENT
========================================================= */

app.post('/api/admin/update-shipment',async(req,res)=>{

const{trackingNumber,status,location,remark}=req.body;

try{

const shipmentResult=await pool.query(
'SELECT id FROM shipments WHERE tracking_number=$1',
[trackingNumber]
);

if(shipmentResult.rows.length===0){
return res.status(404).json({success:false,message:'Shipment not found'});
}

const shipmentId=shipmentResult.rows[0].id;

await pool.query(
'UPDATE shipments SET status=$1,last_updated=NOW() WHERE id=$2',
[status,shipmentId]
);

await pool.query(
`INSERT INTO scan_events (shipment_id,location,remark,scanned_at)
VALUES($1,$2,$3,NOW())`,
[shipmentId,location,remark]
);

res.json({success:true});

}catch(error){
console.error(error);
res.status(500).json({success:false,message:'Update failed'});
}

});

/* =========================================================
ARCHIVE SHIPMENT
========================================================= */

app.post('/api/admin/archive-shipment',async(req,res)=>{

const{tracking}=req.body;

try{

await pool.query(
'UPDATE shipments SET archived=TRUE WHERE tracking_number=$1',
[tracking]
);

res.json({success:true});

}catch(error){
console.error(error);
res.status(500).json({success:false,message:'Archive failed'});
}

});

/* =========================================================
WAYBILL GENERATOR
========================================================= */

app.get('/api/admin/waybill/:trackingNumber',async(req,res)=>{

const{trackingNumber}=req.params;

try{

const result=await pool.query(
'SELECT * FROM shipments WHERE tracking_number=$1',
[trackingNumber]
);

if(result.rows.length===0){
return res.status(404).send('Shipment not found');
}

const shipment=result.rows[0];

const doc=new PDFDocument({size:'A6',margin:20});

res.setHeader('Content-Type','application/pdf');
res.setHeader(
'Content-Disposition',
`inline; filename=waybill-${trackingNumber}.pdf`
);

doc.pipe(res);

doc.fontSize(16).text('BlueRoute Express',{align:'center'});
doc.moveDown();

doc.fontSize(12).text(`Tracking Number: ${shipment.tracking_number}`);
doc.text(`Origin: ${shipment.origin}`);
doc.text(`Destination: ${shipment.destination}`);
doc.text(`Status: ${shipment.status}`);
doc.text(`Last Update: ${shipment.last_updated}`);

doc.moveDown();
doc.text('Handle With Care',{align:'center'});

doc.end();

}catch(error){
console.error(error);
res.status(500).send('Waybill generation failed');
}

});

/* =========================================================
CREATE SHIPMENT (PUBLIC ENDPOINT)
========================================================= */

app.post('/api/shipments',async(req,res)=>{

try{

const{tracking_number,origin,destination,status}=req.body;

const result=await pool.query(
`INSERT INTO shipments
(tracking_number,origin,destination,status,last_updated)
VALUES($1,$2,$3,$4,NOW())
RETURNING *`,
[tracking_number,origin,destination,status]
);

res.json(result.rows[0]);

}catch(error){
console.error(error);
res.status(500).json({error:"Failed to create shipment"});
}

});

app.get("/health", (req, res) => {
  res.send("OK");
});

const PORT=process.env.PORT||3000;

app.listen(PORT,()=>{
console.log(`Server running on port ${PORT}`);
});

// =============================
// ADMIN SESSION CHECK
// =============================
app.get("/api/admin/session-check", (req, res) => {
  res.json({ status: "ok" });
});