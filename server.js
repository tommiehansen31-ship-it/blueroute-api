require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const crypto = require("crypto");

const app = express();

app.use(cors({
origin: [
"https://blueroute.online",
"https://www.blueroute.online"
],
methods: ["GET","POST","PUT","DELETE"],
credentials: true
}));

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

let token = req.headers.authorization;

if(!token){
return res.status(403).json({error:"Unauthorized"});
}

if(token.startsWith("Bearer ")){
token = token.split(" ")[1];
}

const session = ADMIN_SESSIONS[token];

if(!session){
return res.status(403).json({error:"Unauthorized"});
}

if(Date.now() - session.created > SESSION_TTL){
delete ADMIN_SESSIONS[token];
return res.status(403).json({error:"Session expired"});
}

req.adminToken = token;

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

let token = req.headers.authorization;

if(!token){
return res.status(403).json({error:"Unauthorized"});
}

if(token.startsWith("Bearer ")){
token = token.split(" ")[1];
}

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

app.post('/api/admin/create-shipment', async (req,res)=>{

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
boxCount
} = req.body;

try{

const trackingNumber = 'BR' + Date.now() + Math.floor(Math.random()*1000);

const shipmentInsert = await pool.query(
`INSERT INTO shipments
(
tracking_number,
sendername,
senderaddress,
senderphone,
senderemail,
receivername,
receiveraddress,
receiverphone,
receiveremail,
origin,
destination,
shipmentname,
weight,
box_count,
status
)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
weight || null,
boxCount || null,
'Shipment Created'
]
);

const shipmentId = shipmentInsert.rows[0].id;

await pool.query(
`INSERT INTO scan_events (shipment_id,location,remark,scanned_at)
VALUES($1,$2,$3,NOW())`,
[shipmentId, origin, 'Shipment Created']
);

res.json({
success:true,
trackingNumber
});

}catch(error){

console.error("Create shipment error:", error);

res.status(500).json({success:false});

}

});

/* =========================================================
UPDATE SHIPMENT STATUS (WITH REMARKS)
========================================================= */

app.post('/api/admin/update-shipment', async (req,res)=>{

const {trackingNumber,status,remarks} = req.body;

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
[shipmentId,status,remarks || status]
);

res.json({success:true});

}catch(error){

console.error("Update shipment error:",error);

res.status(500).json({success:false});

}

});

/* =========================================================
ADMIN SHIPMENT LIST (PAGINATION + SEARCH)
========================================================= */

app.get('/api/admin/shipments', async (req,res)=>{

try{

const page = parseInt(req.query.page) || 1;
const limit = 20;
const offset = (page - 1) * limit;

const search = req.query.search || "";

let query = `
SELECT
tracking_number AS tracking,
origin,
destination,
status
FROM shipments
`;

let params = [];

if(search){

query += `WHERE tracking_number ILIKE $1`;
params.push(`%${search}%`);

}

query += `
ORDER BY id DESC
LIMIT ${limit}
OFFSET ${offset}
`;

const result = await pool.query(query,params);

res.json(result.rows);

}catch(error){

console.error("Shipment list error:", error);

res.status(500).json({error:"Failed"});

}

});

const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");

/* =========================================================
WAYBILL GENERATOR
========================================================= */

app.get("/api/waybill/:trackingNumber", async (req,res)=>{

const {trackingNumber} = req.params;

try{

const shipmentResult = await pool.query(
`SELECT * FROM shipments WHERE tracking_number=$1`,
[trackingNumber]
);

if(shipmentResult.rows.length === 0){
return res.status(404).json({error:"Shipment not found"});
}

const s = shipmentResult.rows[0];

const doc = new PDFDocument({margin:50});

res.setHeader(
"Content-Disposition",
`inline; filename=${trackingNumber}-waybill.pdf`
);

res.setHeader("Content-Type","application/pdf");

doc.pipe(res);

/* HEADER */

doc.fontSize(22).text("BlueRoute Logistics Waybill",{align:"center"});
doc.moveDown();

/* BARCODE */

const barcode = await bwipjs.toBuffer({
bcid: 'code128',
text: trackingNumber,
scale: 3,
height: 10,
includetext: true
});

doc.image(barcode,{align:"center"});

doc.moveDown(2);

/* SHIPMENT DETAILS */

doc.fontSize(14).text(`Tracking Number: ${s.tracking_number}`);

doc.moveDown();

/* SENDER */

doc.fontSize(16).text("Sender Information",{underline:true});

doc.fontSize(12)
.text(`Name: ${s.sendername || ""}`)
.text(`Address: ${s.senderaddress || ""}`)
.text(`Phone: ${s.senderphone || ""}`)
.text(`Email: ${s.senderemail || ""}`);

doc.moveDown();

/* RECEIVER */

doc.fontSize(16).text("Receiver Information",{underline:true});

doc.fontSize(12)
.text(`Name: ${s.receivername || ""}`)
.text(`Address: ${s.receiveraddress || ""}`)
.text(`Phone: ${s.receiverphone || ""}`)
.text(`Email: ${s.receiveremail || ""}`);

doc.moveDown();

/* SHIPMENT */

doc.fontSize(16).text("Shipment Details",{underline:true});

doc.fontSize(12)
.text(`Origin Country: ${s.origin}`)
.text(`Destination Country: ${s.destination}`)
.text(`Description: ${s.shipmentname || ""}`)
.text(`Weight: ${s.weight || ""} kg`)
.text(`Boxes: ${s.box_count || ""}`);

doc.moveDown();

doc.text(`Created: ${new Date(s.created_at).toLocaleDateString()}`);

doc.moveDown(2);

/* FOOTER */

doc.fontSize(10)
.text("BlueRoute Logistics",{align:"center"})
.text("www.blueroute.online",{align:"center"});

doc.end();

}catch(error){

console.error("Waybill error:",error);

res.status(500).json({error:"Waybill generation failed"});

}

});

const PORT=process.env.PORT||3000;

app.listen(PORT,()=>{
console.log(`Server running on port ${PORT}`);
});