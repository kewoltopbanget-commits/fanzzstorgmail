const express=require("express");
const session=require("express-session");
const Database=require("better-sqlite3");
const path=require("path");

const app=express();
const db=new Database(process.env.DB_PATH||"stor.db");
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE,password TEXT,role TEXT DEFAULT 'member',balance INTEGER DEFAULT 0,payout_method TEXT DEFAULT '',payout_target TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,email TEXT,note TEXT,status TEXT DEFAULT 'pending',price INTEGER DEFAULT 4700,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS withdrawals(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,amount INTEGER,method TEXT,target TEXT,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);`);
const get=(k,d)=>{const x=db.prepare("SELECT value FROM settings WHERE key=?").get(k);return x?x.value:d};
const set=(k,v)=>db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k,String(v));
if(!get("price"))set("price",4700); if(!get("min"))set("min",50000); if(!get("open"))set("open",1);
if(!get("rules"))set("rules","Kirim alamat Gmail yang sah saja. Jangan kirim password, OTP, recovery code, cookie, atau kredensial login.");
if(!db.prepare("SELECT id FROM users WHERE role='admin'").get())db.prepare("INSERT INTO users(email,password,role) VALUES(?,?,?)").run(process.env.ADMIN_EMAIL||"admin@example.com",process.env.ADMIN_PASSWORD||"GantiPasswordAdmin123!","admin");

app.use(express.json());app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||"ganti-secret-ini",resave:false,saveUninitialized:false}));
app.use(express.static(path.join(__dirname,"public")));
const auth=(q,r,n)=>q.session.user?n():r.status(401).json({error:"Belum login"});
const adm=(q,r,n)=>q.session.user?.role==="admin"?n():r.status(403).json({error:"Admin only"});

app.post("/api/register",(q,r)=>{const {email,password}=q.body;if(!email||!password||password.length<8)return r.status(400).json({error:"Email/password tidak valid"});try{const x=db.prepare("INSERT INTO users(email,password) VALUES(?,?)").run(email.toLowerCase(),password);q.session.user={id:x.lastInsertRowid,role:"member",email};r.json({ok:true})}catch(e){r.status(400).json({error:"Email sudah terdaftar"})}});
app.post("/api/login",(q,r)=>{const u=db.prepare("SELECT id,email,password,role,balance,payout_method,payout_target FROM users WHERE email=?").get((q.body.email||"").toLowerCase());if(!u||u.password!==q.body.password)return r.status(401).json({error:"Login salah"});delete u.password;q.session.user=u;r.json({ok:true,user:u})});
app.post("/api/logout",(q,r)=>q.session.destroy(()=>r.json({ok:true})));
app.get("/api/me",auth,(q,r)=>r.json(db.prepare("SELECT id,email,role,balance,payout_method,payout_target FROM users WHERE id=?").get(q.session.user.id)));
app.get("/api/rules",(q,r)=>r.json({rules:get("rules","")}));
app.post("/api/submissions",auth,(q,r)=>{if(get("open","1")!=="1")return r.status(400).json({error:"STOR ditutup"});let a=[...new Set(String(q.body.emails||"").split(/[\n,;]+/).map(x=>x.trim().toLowerCase()).filter(x=>/^[^\s@]+@gmail\.com$/i.test(x)))];if(!a.length)return r.status(400).json({error:"Tidak ada Gmail valid"});let ins=db.prepare("INSERT INTO submissions(user_id,email,note,price) VALUES(?,?,?,?)");for(const e of a)ins.run(q.session.user.id,e,String(q.body.note||"").slice(0,500),Number(get("price",4700)));r.json({count:a.length})});
app.get("/api/submissions",auth,(q,r)=>r.json(q.session.user.role==="admin"?db.prepare("SELECT s.*,u.email member FROM submissions s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC").all():db.prepare("SELECT * FROM submissions WHERE user_id=? ORDER BY id DESC").all(q.session.user.id)));
app.post("/api/submissions/:id/:action",adm,(q,r)=>{const s=db.prepare("SELECT * FROM submissions WHERE id=?").get(q.params.id);if(!s||s.status!=="pending")return r.status(400).json({error:"Tidak tersedia"});if(q.params.action==="accept"){db.prepare("UPDATE submissions SET status='accepted' WHERE id=?").run(s.id);db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(s.price,s.user_id)}else if(q.params.action==="reject")db.prepare("UPDATE submissions SET status='rejected' WHERE id=?").run(s.id);else return r.status(400).json({error:"Aksi salah"});r.json({ok:true})});
app.post("/api/profile",auth,(q,r)=>{db.prepare("UPDATE users SET payout_method=?,payout_target=? WHERE id=?").run(q.body.method||"",q.body.target||"",q.session.user.id);r.json({ok:true})});
app.post("/api/withdrawals",auth,(q,r)=>{let a=Number(q.body.amount),u=db.prepare("SELECT balance,payout_method,payout_target FROM users WHERE id=?").get(q.session.user.id),min=Number(get("min",50000)),method=q.body.method||u.payout_method,target=q.body.target||u.payout_target;if(!Number.isInteger(a)||a<min||a>u.balance||!method||!target)return r.status(400).json({error:"Data penarikan tidak valid"});db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(a,u.id);db.prepare("INSERT INTO withdrawals(user_id,amount,method,target) VALUES(?,?,?,?)").run(u.id,a,method,target);r.json({ok:true})});
app.get("/api/withdrawals",auth,(q,r)=>r.json(q.session.user.role==="admin"?db.prepare("SELECT w.*,u.email member FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC").all():db.prepare("SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC").all(q.session.user.id)));
app.post("/api/withdrawals/:id/pay",adm,(q,r)=>{db.prepare("UPDATE withdrawals SET status='paid' WHERE id=? AND status='pending'").run(q.params.id);r.json({ok:true})});
app.get("/api/settings",adm,(q,r)=>r.json({price:+get("price",4700),min:+get("min",50000),open:get("open","1")==="1",rules:get("rules","")}));
app.post("/api/settings",adm,(q,r)=>{set("price",q.body.price);set("min",q.body.min);set("open",q.body.open?1:0);set("rules",q.body.rules||"");r.json({ok:true})});
app.post("/api/admin/password",adm,(q,r)=>{if(String(q.body.password||"").length<8)return r.status(400).json({error:"Minimal 8 karakter"});db.prepare("UPDATE users SET password=? WHERE id=?").run(q.body.password,q.session.user.id);r.json({ok:true})});
app.listen(process.env.PORT||3000,()=>console.log("STOR Portal aktif"));
