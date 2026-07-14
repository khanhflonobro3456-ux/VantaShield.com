const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const http = require('http');
const session = require('express-session');
const geoip = require('geoip-lite');
const helmet = require('helmet');
const compression = require('compression'); // THÊM COMPRESSION ĐỂ LOAD CỰC NHANH
const app = express();

// Kích hoạt nén GZIP cho tốc độ tải Script cực mượt
app.use(compression());

// ========== LỚP BẢO VỆ 1: HELMET ==========
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: "same-site" },
  dnsPrefetchControl: true,
  frameguard: { action: "deny" },
  hidePoweredBy: true,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
  referrerPolicy: { policy: "no-referrer" },
  xssFilter: true,
}));

// ========== LỚP BẢO VỆ 2: CHỈ CHO PHÉP IP VIỆT NAM ==========
function isVietnameseIP(ip) {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  try {
    const geo = geoip.lookup(ip);
    return geo && geo.country === 'VN';
  } catch (e) {
    return false;
  }
}

// ========== LỚP BẢO VỆ 3: RATE LIMITING ==========
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 100;
const BLOCK_DURATION = 5 * 60 * 1000;

function rateLimitMiddleware(req, res, next) {
  const ip = getClientIP(req);
  const now = Date.now();
  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, firstRequest: now, blockedUntil: 0 });
    return next();
  }
  const record = rateLimitStore.get(ip);
  if (record.blockedUntil > now) {
    return res.status(429).end();
  }
  if (now - record.firstRequest > RATE_LIMIT_WINDOW) {
    record.count = 1;
    record.firstRequest = now;
    return next();
  }
  record.count++;
  if (record.count > RATE_LIMIT_MAX) {
    record.blockedUntil = now + BLOCK_DURATION;
    return res.status(429).end();
  }
  next();
}

// ========== LỚP BẢO VỆ 4: WAF ==========
const maliciousPatterns = [
  /(\bselect\b.*\bfrom\b)/i, /(\bunion\b.*\bselect\b)/i,
  /(\binsert\b.*\binto\b)/i, /(\bupdate\b.*\bset\b)/i,
  /(\bdelete\b.*\bfrom\b)/i, /(\bdrop\b.*\btable\b)/i,
  /(\balter\b.*\btable\b)/i, /(\bexec\b.*\bxp_)/i,
  /<script.*?>.*?<\/script>/i, /onerror\s*=/i,
  /onload\s*=/i, /onclick\s*=/i, /javascript:/i,
  /\.\.\//, /%2e%2e%2f/i,
];

function wafMiddleware(req, res, next) {
  const check = (value) => {
    if (typeof value !== 'string') return false;
    return maliciousPatterns.some(pattern => pattern.test(value));
  };
  for (let key in req.query) if (check(req.query[key])) return res.status(403).end();
  if (req.body) {
    for (let key in req.body) {
      if (typeof req.body[key] === 'string' && check(req.body[key])) return res.status(403).end();
    }
  }
  for (let key in req.params) if (check(req.params[key])) return res.status(403).end();
  next();
}

// ========== LỚP BẢO VỆ 5: LỌC USER-AGENT (LOẠI BỎ BOT, CHỪA EXECUTOR) ==========
const badUserAgents = [
  /curl/i, /wget/i, /python/i, /perl/i, /java/i, /ruby/i,
  /node-fetch/i, /http-client/i, /axios/i, /got/i, /scrapy/i,
  /selenium/i, /phantomjs/i, /headless/i, /puppeteer/i,
  /masscan/i, /nmap/i, /zmap/i, /sqlmap/i, /nikto/i
];

function userAgentFilter(req, res, next) {
  const ua = req.headers['user-agent'] || '';
  // Chỉ block bot cào dữ liệu web, không block các trình duyệt hợp lệ hoặc executor
  if (badUserAgents.some(pattern => pattern.test(ua))) {
    return res.status(403).end();
  }
  next();
}

// ========== LỚP BẢO VỆ 6: MIDDLEWARE TỔNG HỢP ==========
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.connection?.remoteAddress || req.ip || '0.0.0.0';
}

const PUBLIC_ROUTES = [
  '/login', '/register', '/logout', '/favicon.ico',
];

app.use((req, res, next) => {
  // CHO PHÉP TRUY CẬP RAW SCRIPT (BYPASS IP BẢO VỆ ĐỂ PLAYER BLOXFRUIT CÓ THỂ CHẠY)
  const isPublic = PUBLIC_ROUTES.some(r => req.path.startsWith(r)) ||
                   req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico)$/) ||
                   req.path.includes('/refs/heads/main/') ||
                   req.path.startsWith('/v1/');

  rateLimitMiddleware(req, res, (err) => {
    if (err) return next(err);
    userAgentFilter(req, res, (err2) => {
      if (err2) return next(err2);
      wafMiddleware(req, res, (err3) => {
        if (err3) return next(err3);
        if (isPublic) return next();
        
        // CHỈ CHẶN IP VỚI CÁC TRANG QUẢN TRỊ (DASHBOARD)
        const ip = getClientIP(req);
        if (!isVietnameseIP(ip)) return res.status(403).end();
        next();
      });
    });
  });
});

// ========== MASTER IP (CHỈ CHO PHÉP 1 IP DUY NHẤT VÀO DASHBOARD) ==========
let MASTER_IP = null;
const IP_FILE = './master_ip.json';

try {
  if (fs.existsSync(IP_FILE)) {
    const data = JSON.parse(fs.readFileSync(IP_FILE, 'utf8'));
    MASTER_IP = data.masterIP;
  }
} catch(e) {}

let BLOCK_ALL = false;

app.use((req, res, next) => {
  const clientIP = getClientIP(req);

  if (MASTER_IP === null && clientIP && clientIP !== '0.0.0.0') {
    MASTER_IP = clientIP;
    try { fs.writeFileSync(IP_FILE, JSON.stringify({ masterIP: MASTER_IP })); } catch(e) {}
  }

  // Bypass các route Public & Raw scripts
  const isPublic = PUBLIC_ROUTES.some(r => req.path.startsWith(r)) ||
                   req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico)$/) ||
                   req.path.includes('/refs/heads/main/') ||
                   req.path.startsWith('/v1/');
                   
  if (isPublic) return next();

  if (BLOCK_ALL && clientIP !== MASTER_IP) {
    return res.status(403).end();
  }

  if (clientIP !== MASTER_IP) {
    return res.status(403).send('Truy cập bị từ chối. Chỉ thiết bị chủ mới được phép.');
  }

  next();
});

// ============================================================================
// CẤU HÌNH EXPRESS & SESSION
// ============================================================================
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));
app.use(session({
  secret: process.env.SESSION_SECRET || 'vantashield-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// ============================================================================
// CƠ SỞ DỮ LIỆU JSON
// ============================================================================
const DB_FILE = './vantashield_scripts.json';
const USERS_FILE = './vantashield_users.json';
const APIS_FILE = './vantashield_apis.json';
const PING_FILE = './vantashield_ping.json';

function loadJSON(file) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) {}
  return {};
}
function safeWriteFile(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data)); } catch(e) {}
}

let db = new Map(Object.entries(loadJSON(DB_FILE)));
let usersDb = new Map(Object.entries(loadJSON(USERS_FILE)));
let apisDb = new Map(Object.entries(loadJSON(APIS_FILE)));
let pingDb = new Map(Object.entries(loadJSON(PING_FILE)));

if (!usersDb.has('master1')) {
  usersDb.set('master1', { password: 'duykhanh2014' });
  safeWriteFile(USERS_FILE, Object.fromEntries(usersDb));
}

apisDb.forEach((api) => { api.status = 'OFFLINE'; api.pid = null; });
safeWriteFile(APIS_FILE, Object.fromEntries(apisDb));

function saveDb() { safeWriteFile(DB_FILE, Object.fromEntries(db)); }
function saveUsers() { safeWriteFile(USERS_FILE, Object.fromEntries(usersDb)); }
function saveApis() { safeWriteFile(APIS_FILE, Object.fromEntries(apisDb)); }

function getCookie(req, name) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));
}
function getFreePort() {
  let maxPort = 8000;
  apisDb.forEach(api => { if (api.port && api.port >= maxPort) maxPort = api.port + 1; });
  return maxPort;
}
const runningProcesses = {};

async function doFetch(url) {
  try {
    if (typeof fetch === 'function') {
      return await fetch(url, { method: 'GET', headers: { 'User-Agent': 'VantaShield-Ping/1.0' }, redirect: 'follow' });
    } else {
      const nodeFetch = require('node-fetch');
      return await nodeFetch(url, { method: 'GET', headers: { 'User-Agent': 'VantaShield-Ping/1.0' }, redirect: 'follow' });
    }
  } catch (e) { throw e; }
}

// ============================================================================
// NÂNG CẤP NHẬN DIỆN EXECUTOR (CHỐNG SKID)
// ============================================================================
function isRobloxExecutor(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  
  // Kiểm tra Header đặc trưng của Executor
  const customHeaders = req.headers['roblox-id'] || req.headers['roblox-place-id'] || 
                        req.headers['synapse-fingerprint'] || req.headers['krnl-hwid'] || 
                        req.headers['exploit-guid'] || req.headers['x-roblox-client'];
  
  if (customHeaders) return true;

  // Cập nhật các Executor thế hệ mới nhất (Wave, Solara, Celery, Codex...)
  const executors = [
    'roblox', 'rblx', 'synapse', 'krnl', 'fluxus', 'delta', 'hydrogen', 
    'codex', 'arceus', 'wave', 'solara', 'celery', 'valyse', 'vegax', 'cubix', 'evon'
  ];
  
  if (executors.some(ex => ua.includes(ex))) return true;

  // Chặn trình duyệt thông thường nếu không có dấu hiệu Roblox
  if (ua.includes('mozilla') && !ua.includes('roblox')) return false;

  return false; 
}

// ============================================================================
// LUA BOOTSTRAPPER (ANTI-SKID VÀ FAST LOAD CHO BLOXFRUITS)
// ============================================================================
function generateSecureLua(rawCode) {
  return `
-- [[ VANTASHIELD PREMIUM BOOTSTRAPPER ]] --
if not game:IsLoaded() then game.Loaded:Wait() end

-- 1. CHỐNG HTTP SPY
if hookfunction and request then
    local orig_req = request
    hookfunction(request, function(reqData)
        if reqData and type(reqData) == "table" and reqData.Url then
            if string.match(reqData.Url, "vantashield") then
                warn("[VantaShield] Blocked HttpSpy Attempt.")
                return {StatusCode = 403, Body = "Blocked by VantaShield", Headers = {}}
            end
        end
        return orig_req(reqData)
    end)
end

-- 2. CHỐNG AUTO-DUMP / SAVE INSTANCE
if hookfunction and writefile then
    local orig_write = writefile
    hookfunction(writefile, function(filename, content)
        if content and string.match(tostring(content), "VANTASHIELD") then
            return -- Block saving the script
        end
        return orig_write(filename, content)
    end)
end

-- 3. CHẠY SCRIPT TRONG LUỒNG RIÊNG GIÚP MENU LOAD CỰC NHANH
local success, err = coroutine.resume(coroutine.create(function()
    ${rawCode}
end))

if not success then 
    warn("[VantaShield] Execution Failed: " .. tostring(err)) 
end
`;
}

// ============================================================================
// GIAO DIỆN HTML (KHÔNG ĐỔI)
// ============================================================================
const style = `<style>@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Orbitron:wght@400;700;900&display=swap');
body.mobf-root{--vs-bg:#030303;--vs-card:#0a0a0a;--vs-border:#1f1f1f;--vs-border-hover:#333;--vs-text:#888;--vs-text-light:#e0e0e0;--vs-white:#fff;--vs-black:#000;background:var(--vs-bg);color:var(--vs-text-light);font-family:"JetBrains Mono",monospace;min-height:100vh;margin:0;overflow-x:hidden;position:relative}
.mobf-root::before{content:"";position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,0.02)1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02)1px,transparent 1px);background-size:40px 40px;animation:gridMove 20s linear infinite;pointer-events:none;z-index:0}
@keyframes gridMove{to{transform:translateY(40px)}}
.orb{position:fixed;border-radius:50%;filter:blur(100px);opacity:.03;pointer-events:none;z-index:0;animation:orbFloat 10s ease-in-out infinite}
.orb1{width:500px;height:500px;background:#fff;top:-100px;left:-100px}
.orb2{width:450px;height:450px;background:#fff;bottom:-150px;right:-100px;animation-delay:-3s}
.orb3{width:300px;height:300px;background:#fff;top:40%;left:30%;animation-delay:-6s;opacity:.01}
@keyframes orbFloat{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(30px,-30px) scale(1.1)}}
.mobf-nav{position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:16px 32px;background:rgba(3,3,3,.85);backdrop-filter:blur(16px);border-bottom:1px solid var(--vs-border)}
.nav-logo{font-family:Orbitron,sans-serif;font-size:22px;font-weight:900;letter-spacing:2px;color:var(--vs-white);text-decoration:none;display:flex;align-items:center;gap:8px}
.menu-toggle{font-size:24px;background:0 0;border:none;color:var(--vs-white);cursor:pointer;display:flex;align-items:center}
.menu-toggle:hover{color:var(--vs-text);transform:scale(1.1)}
.sidebar{position:fixed;top:0;left:-300px;width:280px;height:100vh;background:#050505;border-right:1px solid var(--vs-border);z-index:999;padding:30px 20px;box-sizing:border-box;transition:all .4s cubic-bezier(.77,0,.175,1);box-shadow:10px 0 30px rgba(0,0,0,.9)}
.sidebar.active{left:0}
.sidebar-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:30px;font-family:Orbitron;font-weight:700;color:var(--vs-text-light)}
.sidebar-close{background:0 0;border:none;color:var(--vs-text);font-size:20px;cursor:pointer;display:flex}
.sidebar-close:hover{color:var(--vs-white)}
.sidebar-menu a{display:flex;align-items:center;gap:12px;padding:14px 18px;color:var(--vs-text);text-decoration:none;border-radius:8px;margin-bottom:5px;transition:.3s;font-weight:700}
.sidebar-menu a i{font-size:18px}
.sidebar-menu a:hover{background:rgba(255,255,255,.05);color:var(--vs-white)}
.user-badge{background:rgba(255,255,255,.02);padding:12px;border-radius:8px;font-size:12px;margin-bottom:20px;border:1px solid var(--vs-border);text-align:center;color:var(--vs-text)}
.hero{position:relative;z-index:1;text-align:center;padding:40px 20px 20px;max-width:860px;margin:0 auto}
.hero-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border:1px solid var(--vs-border-hover);border-radius:20px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--vs-text-light);margin-bottom:20px;background:rgba(255,255,255,.02)}
.hero h1{font-family:Orbitron,sans-serif;font-size:clamp(26px,5vw,42px);font-weight:900;letter-spacing:2px;margin:0 0 10px;color:var(--vs-white)}
.center-card-wrap{position:relative;z-index:1;max-width:800px;margin:0 auto 80px;padding:0 20px}
.quick-card{background:var(--vs-card);border:1px solid var(--vs-border);border-radius:12px;padding:32px;position:relative;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.8)}
.header-flex{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px}
.field-label{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:var(--vs-text-light);font-weight:700;margin:0 0 10px;display:block}
.quick-card input[type=text],.quick-card input[type=password]{width:100%;padding:14px;background:var(--vs-black);border:1px solid var(--vs-border);border-radius:8px;color:var(--vs-white);font-family:"JetBrains Mono",monospace;font-size:14px;box-sizing:border-box;outline:0;transition:all .3s;margin-bottom:20px}
.quick-card input:focus,.quick-card textarea:focus{border-color:var(--vs-text);box-shadow:0 0 15px rgba(255,255,255,.05)}
.btn-upload{background:rgba(255,255,255,.02);color:var(--vs-text);border:1px dashed var(--vs-border-hover);padding:10px 15px;border-radius:8px;font-size:12px;cursor:pointer;transition:all .3s;font-family:Orbitron;display:inline-flex;align-items:center;gap:8px;font-weight:700}
.btn-upload:hover{background:rgba(255,255,255,.05);color:var(--vs-white);border-color:var(--vs-text)}
input[type=file]{display:none}
.quick-card textarea{width:100%;height:250px;background:var(--vs-black);border:1px solid var(--vs-border);border-radius:8px;color:var(--vs-text-light);font-family:"JetBrains Mono",monospace;font-size:13px;padding:14px;box-sizing:border-box;outline:0;transition:all .3s;resize:none;margin-bottom:15px}
.btn-save{width:100%;padding:16px;border:none;border-radius:8px;font-family:Orbitron;font-size:15px;font-weight:900;letter-spacing:2px;cursor:pointer;color:var(--vs-black);background:var(--vs-white);transition:all .2s;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:10px;box-sizing:border-box}
.btn-save:hover{background:var(--vs-text-light);transform:translateY(-2px);box-shadow:0 8px 25px rgba(255,255,255,.15)}
.result-box{margin-top:15px;padding:20px;border-radius:8px;background:var(--vs-black);border:1px solid var(--vs-border);text-align:left;position:relative}
.copy-btn{position:absolute;top:10px;right:10px;background:var(--vs-border);color:var(--vs-text-light);border:1px solid var(--vs-border-hover);padding:8px 16px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:Orbitron;transition:.3s}
.copy-btn:hover{background:var(--vs-white);color:var(--vs-black)}
.code-preview{color:var(--vs-text-light);word-break:break-all;font-size:13px;line-height:1.5;margin-top:10px;white-space:pre-wrap}
.manage-wrap{overflow-x:auto;width:100%}
.manage-table{width:100%;min-width:600px;border-collapse:collapse;margin-top:15px;font-size:13px}
.manage-table th{background:rgba(255,255,255,.02);color:var(--vs-text-light);padding:12px;text-align:left;border-bottom:1px solid var(--vs-border);font-family:Orbitron}
.manage-table td{padding:14px 12px;border-bottom:1px solid rgba(255,255,255,.02);vertical-align:middle}
.btn-action{padding:6px 10px;border:1px solid var(--vs-border);border-radius:6px;font-family:"JetBrains Mono";cursor:pointer;font-weight:700;font-size:11px;text-decoration:none;margin-right:5px;display:inline-flex;align-items:center;gap:6px;margin-bottom:5px;background:var(--vs-black);color:var(--vs-text-light);transition:.2s}
.btn-action:hover{border-color:var(--vs-text);color:var(--vs-white)}
.btn-delete:hover{border-color:#ef4444;color:#ef4444}
.badge-admin{background:var(--vs-white);color:var(--vs-black);padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700}
.alert{padding:15px;background:rgba(255,255,255,.05);border:1px solid var(--vs-border);color:var(--vs-text-light);border-radius:8px;margin-bottom:20px;text-align:center;font-weight:700}
.alert-success{background:rgba(255,255,255,.1);border:1px solid var(--vs-text);color:var(--vs-white)}
.tos-list{text-align:left;margin-top:20px}
.tos-item{margin-bottom:25px;padding-bottom:15px;border-bottom:1px solid var(--vs-border)}
.tos-title{font-family:Orbitron;font-size:16px;color:var(--vs-white);margin-bottom:8px;font-weight:700}
.tos-title span{color:var(--vs-text);margin-right:8px}
.tos-desc{font-size:14px;color:var(--vs-text);line-height:1.6}
.troll-screen{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#000;color:#f00;font-family:monospace;text-align:center}
.troll-text{font-size:50px;font-weight:bold;margin-bottom:20px;animation:glitch 1s linear infinite}
.troll-sub{font-size:20px;color:#fff}
@keyframes glitch{2%,64%{transform:translate(2px,0) skew(0deg)}4%,60%{transform:translate(-2px,0) skew(0deg)}62%{transform:translate(0,0) skew(5deg)}}
</style>`;

const baseHTML = (content, userSession = null) => {
  const isAdmin = userSession === 'master1';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VantaShield.com | Protected Hub</title>${style}</head>
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
        <div style="display:flex;justify-content:center;align-items:center;gap:6px;margin-bottom:8px"><i class="ph-fill ph-check-circle" style="color:var(--vs-white)"></i> Logged in as:</div>
        <b style="color:var(--vs-white);font-size:16px;display:flex;justify-content:center;align-items:center;gap:6px">${escapeHTML(userSession).toUpperCase()} ${isAdmin ? '<i class="ph-fill ph-crown"></i>' : ''}</b>
      </div>
      <div class="sidebar-menu">
        <a href="/"><i class="ph ph-house"></i> Creator Home</a>
        <a href="/dashboard"><i class="ph ph-file-code"></i> Script Management</a>
        <a href="/api-hosting"><i class="ph ph-cloud-arrow-up"></i> Tạo Web (Hosting)</a>
        <a href="/ping"><i class="ph ph-pulse"></i> Ping Monitor</a>
        <a href="/tos"><i class="ph ph-scroll"></i> Terms of Service</a>
        <a href="/logout" style="color:var(--vs-text);margin-top:40px"><i class="ph ph-sign-out"></i> Logout</a>
      </div>
      ` : `
      <div class="user-badge"><i class="ph-fill ph-x-circle" style="margin-right:6px"></i> Not Logged In</div>
      <div class="sidebar-menu" style="text-align:center">
        <p style="font-size:12px;color:var(--vs-text);margin-bottom:15px">Log in to securely save, edit, and manage your scripts globally.</p>
        <a href="/login" style="background:var(--vs-white);color:var(--vs-black);font-size:13px;margin-bottom:10px;justify-content:center"><i class="ph ph-key"></i> Login</a>
        <a href="/register" style="background:var(--vs-border);color:var(--vs-white);font-size:13px;margin-bottom:20px;justify-content:center"><i class="ph ph-user-plus"></i> Create Account</a>
        <div style="border-top:1px solid var(--vs-border);padding-top:10px">
          <a href="/api-hosting"><i class="ph ph-cloud-arrow-up"></i> Tạo Web (Hosting)</a>
          <a href="/tos" style="color:var(--vs-text)"><i class="ph ph-scroll"></i> Terms of Service</a>
        </div>
      </div>
      `}
    </div>
    <main>${content}</main>
    <script>
      function toggleSidebar(){document.getElementById('sidebarNav').classList.toggle('active')}
      function handleFileUpload(e){const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=function(e){document.getElementById('codeArea').value=e.target.result};r.readAsText(f)}
      function copyText(id,btn){const t=document.getElementById(id).innerText;const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');btn.innerHTML='<i class="ph ph-check"></i> COPIED!';btn.style.background='var(--vs-white)';btn.style.color='var(--vs-black)';setTimeout(()=>{btn.innerHTML='<i class="ph ph-copy"></i> COPY';btn.style.background='var(--vs-border)';btn.style.color='var(--vs-text-light)'},2000)}catch(e){}document.body.removeChild(ta)}
      function copyApiLink(name,btn){const url=window.location.origin+'/app/'+name;const ta=document.createElement('textarea');ta.value=url;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');btn.innerHTML='<i class="ph ph-check"></i> COPIED!';btn.style.borderColor='var(--vs-white)';btn.style.color='var(--vs-white)';setTimeout(()=>{btn.innerHTML='<i class="ph ph-copy"></i> COPY LINK';btn.style.borderColor='var(--vs-border)';btn.style.color='var(--vs-text-light)'},2000)}catch(e){}document.body.removeChild(ta)}
      function openApiLink(name){window.open(window.location.origin+'/app/'+name,'_blank')}
    </script>
    <script src="https://unpkg.com/@phosphor-icons/web"></script>
  </body></html>`;
};

// ============================================================================
// CÁC ROUTE KHÁC ĐƯỢC GIỮ NGUYÊN (Dashboard, Hosting, Auth, Ping,...)
// ============================================================================
// [TÔI LƯỢC BỎ BỚT TRONG CHẾ ĐỘ HIỂN THỊ ĐỂ DỄ NHÌN, BẠN GIỮ NGUYÊN CODE CŨ TỪ ĐÂY ĐẾN TRƯỚC PHẦN RAW SCRIPT]

app.post('/toggle-block', (req, res) => {
  const user = getCookie(req, 'user_session');
  if (user !== 'master1') return res.status(403).send('Unauthorized');
  BLOCK_ALL = !BLOCK_ALL;
  res.json({ blocked: BLOCK_ALL });
});

app.use('/app/:name', (req, res) => {
  try {
    const name = req.params.name;
    const api = Array.from(apisDb.values()).find(a => a.name === name);
    if (!api) return res.status(404).send('<h2>404 - KHÔNG TÌM THẤY WEB</h2>');
    if (api.status !== 'ONLINE') return res.status(503).send('<h2>503 - WEB ĐANG TẮT</h2>');
    const options = { hostname: '127.0.0.1', port: api.port, path: req.url || '/', method: req.method, headers: { ...req.headers, host: `127.0.0.1:${api.port}` } };
    const proxyReq = http.request(options, (proxyRes) => { res.writeHead(proxyRes.statusCode, proxyRes.headers); proxyRes.pipe(res, { end: true }); });
    req.pipe(proxyReq, { end: true });
    proxyReq.on('error', () => res.status(502).send('502 - Bad Gateway'));
  } catch (err) { res.status(500).send('Lỗi reverse proxy'); }
});

// [... KẾT THÚC PHẦN ROUTE QUẢN TRỊ ...]

// ============================================================================
// RAW SCRIPT & ANTI-SKID (ĐÃ NÂNG CẤP MẠNH MẼ)
// ============================================================================
app.all('/:creatorName/:fileName/refs/heads/main/:fileName2', (req, res) => {
  const { creatorName, fileName } = req.params;
  let data = null;
  for (const [key, val] of db.entries()) {
    const vc = val.owner === 'guest_anonymous' ? 'anonymous' : val.owner;
    if ((val.fileName === fileName || key === fileName) && vc === creatorName) { data = val; break; }
  }

  // Tắt cache để tránh rò rỉ script qua HTTP Proxies
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (isRobloxExecutor(req)) {
    if (!data) return res.status(404).send('print("[VantaShield] Script Not Found")');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    
    // BỌC CODE BẰNG BOOTSTRAPPER ĐỂ LOAD CỰC NHANH VÀ CHỐNG SPY
    return res.send(generateSecureLua(data.code));
  }
  
  // NẾU LÀ TRÌNH DUYỆT HOẶC SKIDDER
  return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SKID DETECTED</title>${style}</head><body><div class="troll-screen"><div class="troll-text">SKID ALERT !</div><div class="troll-sub">Get out! Stealing source code is strictly prohibited.</div></div><script>setTimeout(()=>window.location.href="https://www.google.com",3000);</script></body></html>`);
});

app.all('/v1/:id', (req, res) => {
  const id = req.params.id;
  const data = db.get(id);

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (isRobloxExecutor(req)) {
    if (!data) return res.status(404).send('print("[VantaShield] Script Not Found")');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    
    return res.send(generateSecureLua(data.code));
  }
  
  return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SKID DETECTED</title>${style}</head><body><div class="troll-screen"><div class="troll-text">SKID ALERT !</div><div class="troll-sub">Get out!</div></div><script>setTimeout(()=>window.location.href="https://www.google.com",3000);</script></body></html>`);
});

// ============================================================================
