const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const http = require('http');
const app = express();

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
            <div style="background:#09090b;color:#ef4444;font-family:monospace;padding:20px;text-align:center;">
                <h2>404 - KHÔNG TÌM THẤY WEB</h2>
                <p>Web [${name}] không tồn tại trên hệ thống.</p>
            </div>
        `);
    }
    
    if (api.status !== 'ONLINE') {
        return res.status(503).send(`
            <div style="background:#09090b;color:#eab308;font-family:monospace;padding:20px;text-align:center;">
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
// CONFIGURATION
// ============================================================================
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// ============================================================================
// DATA PERSISTENCE (LƯU TRỮ VÀO FILE)
// ============================================================================
const DB_FILE = './vantashield_scripts.json';
const USERS_FILE = './vantashield_users.json';
const APIS_FILE = './vantashield_apis.json';

let db = new Map();
let usersDb = new Map();

// Load existing data
if (fs.existsSync(DB_FILE)) {
    db = new Map(Object.entries(JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))));
}
if (fs.existsSync(USERS_FILE)) {
    usersDb = new Map(Object.entries(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))));
}
if (fs.existsSync(APIS_FILE)) {
    apisDb = new Map(Object.entries(JSON.parse(fs.readFileSync(APIS_FILE, 'utf8'))));
    apisDb.forEach((api, key) => {
        api.status = 'OFFLINE';
        api.pid = null;
        apisDb.set(key, api);
    });
    saveApis();
}

// Master Admin Default
if (!usersDb.has('master1')) {
    usersDb.set('master1', { password: 'duykhanh2014' });
    saveUsers();
}

function saveDb() { fs.writeFileSync(DB_FILE, JSON.stringify(Object.fromEntries(db))); }
function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(Object.fromEntries(usersDb))); }
function saveApis() { fs.writeFileSync(APIS_FILE, JSON.stringify(Object.fromEntries(apisDb))); }

// Utilities
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

function isRobloxExecutor(req) {
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    return userAgent.includes('roblox') || userAgent.includes('rblx') || !userAgent.includes('mozilla');
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
// 1. STYLE, CSS & CLIENT-SIDE SCRIPTS
// ============================================================================
const style = `
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Orbitron:wght@400;700;900&display=swap');

body.mobf-root {
  --vs-bg: #09090b; --vs-card: #18181b; --vs-border: rgba(255, 255, 255, 0.1);
  --vs-cyan: #06b6d4; --vs-purple: #a855f7; --vs-pink: #ec4899; --vs-gold: #eab308; --vs-red: #ef4444; --vs-green: #10b981;
  background: var(--vs-bg); color: #e4e4e7;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  min-height: 100vh; margin: 0; overflow-x: hidden; position: relative;
}
.mobf-root::before {
  content: ""; position: fixed; inset: 0;
  background-image: linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 40px 40px; animation: gridMove 20s linear infinite; pointer-events: none; z-index: 0;
}
@keyframes gridMove { to { transform: translateY(40px); } }

.orb { position: fixed; border-radius: 50%; filter: blur(90px); opacity: 0.15; pointer-events: none; z-index: 0; animation: orbFloat 10s ease-in-out infinite; }
.orb1 { width: 500px; height: 500px; background: var(--vs-purple); top: -100px; left: -100px; }
.orb2 { width: 450px; height: 450px; background: var(--vs-pink); bottom: -150px; right: -100px; animation-delay: -3s; }
.orb3 { width: 300px; height: 300px; background: var(--vs-cyan); top: 40%; left: 30%; animation-delay: -6s; opacity: 0.1; }
@keyframes orbFloat { 0%,100%{ transform:translate(0,0) scale(1);} 50%{ transform:translate(30px,-30px) scale(1.1);} }

.mobf-nav {
  position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between;
  padding: 16px 32px; background: rgba(9, 9, 11, 0.85); backdrop-filter: blur(16px); border-bottom: 1px solid var(--vs-border);
}
.nav-logo {
  font-family: "Orbitron", sans-serif; font-size: 22px; font-weight: 900; letter-spacing: 2px;
  background: linear-gradient(135deg, var(--vs-cyan), var(--vs-purple), var(--vs-pink));
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; text-decoration: none;
}
.menu-toggle { font-size: 24px; background: none; border: none; color: var(--vs-cyan); cursor: pointer; transition: 0.3s; }
.menu-toggle:hover { color: #fff; transform: scale(1.1); }

.sidebar {
  position: fixed; top: 0; left: -300px; width: 280px; height: 100vh; background: #0f0f13;
  border-right: 1px solid var(--vs-border); z-index: 999; padding: 30px 20px; box-sizing: border-box;
  transition: all 0.4s cubic-bezier(0.77, 0, 0.175, 1); box-shadow: 10px 0 30px rgba(0,0,0,0.9);
}
.sidebar.active { left: 0; }
.sidebar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; font-family: "Orbitron"; font-weight: bold; color: var(--vs-cyan); }
.sidebar-close { background: none; border: none; color: var(--vs-red); font-size: 20px; cursor: pointer; }
.sidebar-menu a { display: block; padding: 14px 18px; color: #e4e4e7; text-decoration: none; border-radius: 8px; margin-bottom: 10px; transition: 0.3s; font-weight: bold;}
.sidebar-menu a:hover { background: rgba(168, 85, 247, 0.15); color: var(--vs-cyan); padding-left: 25px; }
.user-badge { background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; font-size: 12px; margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.05); text-align: center;}

.hero { position: relative; z-index: 1; text-align: center; padding: 40px 20px 20px; max-width: 860px; margin: 0 auto; }
.hero-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px; border: 1px solid rgba(6, 182, 212, 0.35); border-radius: 20px; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--vs-cyan); margin-bottom: 20px; background: rgba(6, 182, 212, 0.08); }
.hero h1 { font-family: "Orbitron", sans-serif; font-size: clamp(26px, 5vw, 42px); font-weight: 900; letter-spacing: 2px; margin: 0 0 10px 0; }
.hero h1 .line2 { background: linear-gradient(135deg, var(--vs-cyan), var(--vs-purple)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }

.center-card-wrap { position: relative; z-index: 1; max-width: 800px; margin: 0 auto 80px; padding: 0 20px; }
.quick-card { background: var(--vs-card); border: 1px solid var(--vs-border); border-radius: 20px; padding: 32px; position: relative; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.8); }

.header-flex { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;}
.field-label { font-size: 13px; letter-spacing: 2px; text-transform: uppercase; color: var(--vs-purple); font-weight: bold; margin: 0 0 10px 0; display: block;}

.quick-card input[type="text"], .quick-card input[type="password"] { width: 100%; padding: 14px; background: rgba(0,0,0,0.7); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 10px; color: var(--vs-cyan); font-family: "JetBrains Mono", monospace; font-size: 14px; box-sizing: border-box; outline: none; transition: all .3s; margin-bottom: 20px; }
.quick-card input:focus, .quick-card textarea:focus { border-color: var(--vs-cyan); box-shadow: 0 0 15px rgba(6, 182, 212, 0.2); }

.btn-upload { background: rgba(168, 85, 247, 0.1); color: var(--vs-cyan); border: 1px dashed var(--vs-purple); padding: 10px 15px; border-radius: 8px; font-size: 12px; cursor: pointer; transition: all 0.3s; font-family: "Orbitron"; display: inline-block; font-weight: bold; }
.btn-upload:hover { background: rgba(168, 85, 247, 0.4); color: #fff; }
input[type="file"] { display: none; }

.quick-card textarea { width: 100%; height: 250px; background: rgba(0,0,0,0.7); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 10px; color: var(--vs-cyan); font-family: "JetBrains Mono", monospace; font-size: 13px; padding: 14px; box-sizing: border-box; outline: none; transition: all .3s; resize: none; margin-bottom: 15px; }

.btn-save { width: 100%; padding: 16px; border: none; border-radius: 12px; font-family: "Orbitron"; font-size: 15px; font-weight: 700; letter-spacing: 2px; cursor: pointer; color: #fff; background: linear-gradient(135deg, var(--vs-cyan), var(--vs-purple), var(--vs-pink)); background-size: 200% 200%; animation: gradShift 4s ease infinite; transition: all .2s; text-decoration:none; display:block; text-align:center; box-sizing:border-box;}
.btn-save:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(168, 85, 247, 0.4); }
@keyframes gradShift { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }

.result-box { margin-top: 15px; padding: 20px; border-radius: 12px; background: rgba(0,0,0,0.5); border: 1px solid rgba(6, 182, 212, 0.4); text-align: left; position: relative;}
.copy-btn { position: absolute; top: 10px; right: 10px; background: var(--vs-purple); color: white; border: none; padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer; font-family: "Orbitron"; transition: 0.3s; }
.copy-btn:hover { background: var(--vs-pink); }
.code-preview { color: var(--vs-cyan); word-break: break-all; font-size: 13px; line-height: 1.5; margin-top: 10px; }

/* MANAGEMENT TABLE */
.manage-wrap { overflow-x: auto; width: 100%; }
.manage-table { width: 100%; min-width: 600px; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
.manage-table th { background: rgba(255,255,255,0.03); color: var(--vs-purple); padding: 12px; text-align: left; border-bottom: 1px solid var(--vs-border); font-family: "Orbitron"; }
.manage-table td { padding: 14px 12px; border-bottom: 1px solid rgba(255,255,255,0.02); vertical-align: middle; }
.btn-action { padding: 6px 10px; border: none; border-radius: 6px; font-family: "JetBrains Mono"; cursor: pointer; font-weight: bold; font-size: 11px; text-decoration: none; margin-right: 5px; display: inline-block; margin-bottom: 5px;}
.btn-edit { background: var(--vs-gold); color: #000; }
.btn-delete { background: var(--vs-red); color: #fff; }
.btn-download { background: var(--vs-green); color: #fff; }
.btn-open { background: var(--vs-cyan); color: #000; }
.btn-start { background: var(--vs-purple); color: #fff; }
.badge-admin { background: var(--vs-gold); color: #000; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; }

/* CHAT SYSTEM UI */
.chat-box { background: rgba(0,0,0,0.5); border: 1px solid var(--vs-border); border-radius: 12px; height: 400px; display: flex; flex-direction: column; overflow: hidden; }
.chat-messages { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; }
.chat-msg { max-width: 80%; padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.4; }
.msg-bot { background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.3); align-self: flex-start; border-bottom-left-radius: 2px; }
.msg-user { background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.3); align-self: flex-end; border-bottom-right-radius: 2px; color: var(--vs-cyan); }
.chat-input-area { display: flex; gap: 10px; padding: 15px; background: rgba(255,255,255,0.02); border-top: 1px solid var(--vs-border); align-items: center; }
.btn-attach { background: rgba(255,255,255,0.05); border: 1px solid var(--vs-border); color: var(--vs-cyan); width: 45px; height: 45px; border-radius: 10px; font-size: 24px; cursor: pointer; display: flex; justify-content: center; align-items: center; transition: 0.3s; }
.btn-attach:hover { background: var(--vs-cyan); color: #000; }
.chat-input { flex: 1; background: rgba(0,0,0,0.7); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 10px; color: #fff; padding: 0 15px; height: 45px; font-family: "JetBrains Mono"; outline: none; }
.btn-send { background: var(--vs-purple); border: none; color: white; padding: 0 20px; height: 45px; border-radius: 10px; font-family: "Orbitron"; font-weight: bold; cursor: pointer; transition: 0.3s; }
.btn-send:hover { background: var(--vs-pink); }

/* TERMINAL LOADER */
#loader-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 99999; flex-direction: column; justify-content: center; align-items: center; }
.terminal-window { width: 90%; max-width: 600px; background: #000; border: 1px solid var(--vs-cyan); border-radius: 10px; overflow: hidden; box-shadow: 0 0 30px rgba(6, 182, 212, 0.3); }
.terminal-header { background: #111; padding: 10px; display: flex; gap: 8px; border-bottom: 1px solid #333; }
.terminal-dot { width: 12px; height: 12px; border-radius: 50%; }
.terminal-body { padding: 20px; font-family: 'JetBrains Mono', monospace; font-size: 14px; color: var(--vs-green); min-height: 250px; display: flex; flex-direction: column; gap: 10px; }
.term-line { opacity: 0; animation: fadeIn 0.3s forwards; }
.blink { animation: blinker 1s linear infinite; }
@keyframes fadeIn { to { opacity: 1; } }
@keyframes blinker { 50% { opacity: 0; } }

/* TROLL SCREEN & ALERTS */
.cyber-text-alert { font-family: 'Orbitron', sans-serif; font-size: 13px; font-weight: bold; color: var(--vs-cyan); text-shadow: 0 0 8px rgba(6, 182, 212, 0.6); letter-spacing: 1px; animation: pulseGlow 2s infinite; }
@keyframes pulseGlow { 0%, 100% { opacity: 1; text-shadow: 0 0 8px rgba(6, 182, 212, 0.6); } 50% { opacity: 0.8; text-shadow: 0 0 15px rgba(6, 182, 212, 1); } }
.troll-screen { position: fixed; inset: 0; z-index: 999999; background: #000; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
.troll-text { font-family: 'Orbitron', sans-serif; font-size: clamp(38px, 8vw, 90px); font-weight: 900; color: var(--vs-red); text-shadow: 2px 2px 0px #fff; animation: shake 0.1s infinite; margin-bottom: 15px; }
.troll-sub { font-size: 20px; background: var(--vs-card); color: var(--vs-gold); padding: 12px 25px; font-weight: bold; border-radius: 8px; border: 1px solid var(--vs-red); }
@keyframes shake { 0% { transform: translate(2px, 2px); } 50% { transform: translate(-2px, -2px); } 100% { transform: translate(2px, -2px); } }
.alert { padding: 15px; background: rgba(239, 68, 68, 0.1); border: 1px solid var(--vs-red); color: #fca5a5; border-radius: 8px; margin-bottom: 20px; text-align: center; font-weight: bold; }
.alert-success { background: rgba(16, 185, 129, 0.1); border: 1px solid var(--vs-green); color: #6ee7b7; }

/* TOS */
.tos-list { text-align: left; margin-top: 20px; }
.tos-item { margin-bottom: 25px; padding-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.05); }
.tos-title { font-family: 'Orbitron'; font-size: 16px; color: var(--vs-cyan); margin-bottom: 8px; font-weight: bold; }
.tos-title span { color: var(--vs-purple); margin-right: 8px; }
.tos-desc { font-size: 14px; color: #a1a1aa; line-height: 1.6; }
</style>

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
        btnElement.innerText = 'COPIED!'; btnElement.style.background = 'var(--vs-cyan)'; btnElement.style.color = '#000';
        setTimeout(() => { btnElement.innerText = 'COPY'; btnElement.style.background = 'var(--vs-purple)'; btnElement.style.color = '#fff'; }, 2000);
    } catch (err) { console.error(err); }
    document.body.removeChild(textArea);
}

function copyApiLink(projectName, btnElement) {
    const url = window.location.origin + '/app/' + projectName;
    const textArea = document.createElement("textarea");
    textArea.value = url; document.body.appendChild(textArea); textArea.select();
    try {
        document.execCommand('copy');
        btnElement.innerText = 'COPIED!'; 
        btnElement.style.background = 'var(--vs-purple)'; btnElement.style.color = '#fff';
        setTimeout(() => { btnElement.innerText = 'COPY LINK'; btnElement.style.background = 'var(--vs-gold)'; btnElement.style.color = '#000'; }, 2000);
    } catch(e) {}
    document.body.removeChild(textArea);
}

function openApiLink(projectName) {
    const url = window.location.origin + '/app/' + projectName;
    window.open(url, '_blank');
}

// ============================================================================
// AUTO-TRANSLATE SYSTEM
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
        <a href="/" class="nav-logo">VANTASHIELD.COM</a>
        <button class="menu-toggle" onclick="toggleSidebar()">☰</button>
    </nav>

    <div class="sidebar" id="sidebarNav">
        <div class="sidebar-header">
            <span>NAVIGATION</span>
            <button class="sidebar-close" onclick="toggleSidebar()">✕</button>
        </div>
        ${userSession ? `
            <div class="user-badge">
                🟢 Logged in as:<br> 
                <b style="color:${isAdmin ? 'var(--vs-gold)' : 'var(--vs-cyan)'}; font-size: 16px;">
                    ${escapeHTML(userSession).toUpperCase()} ${isAdmin ? '👑' : ''}
                </b>
            </div>
            <div class="sidebar-menu">
                <a href="/">🏠 Creator Home</a>
                <a href="/dashboard">📊 Script Management</a>
                <a href="/api-hosting" style="color:var(--vs-cyan);">🚀 Tạo Web (Hosting)</a>
                <a href="/chat-vn">🇻🇳 VN Chat</a>
                <a href="/chat-global">🌍 Global Chat</a>
                <a href="/tos">📜 Terms of Service</a>
                <a href="/logout" style="color: var(--vs-red); margin-top: 40px;">🚪 Logout</a>
            </div>
        ` : `
            <div class="user-badge">🔴 Not Logged In</div>
            <div class="sidebar-menu" style="text-align:center;">
                <p style="font-size:12px; color:#a1a1aa; margin-bottom:15px;">Log in to securely save, edit, and manage your scripts globally.</p>
                <a href="/login" style="background:var(--vs-purple); color:#fff; font-size:13px; margin-bottom:10px;">🔑 Login</a>
                <a href="/register" style="background:var(--vs-cyan); color:#000; font-size:13px; margin-bottom:20px;">📝 Create Account</a>
                <div style="border-top: 1px solid var(--vs-border); padding-top: 10px;">
                    <a href="/api-hosting" style="color:var(--vs-cyan); font-size: 13px; display:block; margin-bottom:10px;">🚀 Tạo Web (Hosting)</a>
                    <a href="/chat-vn" style="color:#fff; font-size: 13px; display:block; margin-bottom:10px;">🇻🇳 VN Chat</a>
                    <a href="/chat-global" style="color:#fff; font-size: 13px; display:block; margin-bottom:10px;">🌍 Global Chat</a>
                    <a href="/tos" style="color:#a1a1aa; font-size: 13px;">📜 Terms of Service</a>
                </div>
            </div>
        `}
    </div>

    <main>${content}</main>

    <!-- LOADING OVERLAY CHO TẠO WEB -->
    <div id="loader-overlay">
        <div class="terminal-window">
            <div class="terminal-header">
                <div class="terminal-dot" style="background:#ef4444;"></div>
                <div class="terminal-dot" style="background:#eab308;"></div>
                <div class="terminal-dot" style="background:#10b981;"></div>
                <div style="color:#666; font-size:12px; margin-left:10px; line-height:12px;">VantaShield Server Deploy</div>
            </div>
            <div class="terminal-body" id="term-body"></div>
        </div>
    </div>
</body>
</html>
`};

// ============================================================================
// 2. CREATE WEB (GÓI GỌN CẢ GITHUB VÀ TẠO BẰNG TAY)
// ============================================================================
app.get('/api-hosting', (req, res) => {
    const user = getCookie(req, 'user_session');
    if (!user) return res.redirect('/login?error=Bạn cần đăng nhập để sử dụng API Hosting.');

    const isAdmin = user === 'master1';
    let rowsHtml = '';
    
    apisDb.forEach((val, key) => {
        if (isAdmin || val.owner === user) {
            const statusColor = val.status === 'ONLINE' ? 'var(--vs-green)' : 'var(--vs-red)';
            rowsHtml += `
                <tr>
                    <td style="color:var(--vs-cyan); font-weight:bold;">${escapeHTML(val.name)}</td>
                    ${isAdmin ? `<td><span class="badge-admin">${val.owner.toUpperCase()}</span></td>` : ''}
                    <td><span style="color: ${statusColor}; font-weight: bold;">${val.status === 'ONLINE' ? '🟢 ONLINE' : '🔴 OFFLINE'}</span></td>
                    <td>/app/${val.name}</td>
                    <td>
                        ${val.status === 'ONLINE' ? `
                            <button class="btn-action btn-open" onclick="openApiLink('${val.name}')">MỞ WEB</button>
                            <button class="btn-action btn-edit" onclick="copyApiLink('${val.name}', this)">COPY LINK</button>
                            <form action="/api-action/stop/${key}" method="POST" style="display:inline;"><button type="submit" class="btn-action btn-delete">STOP</button></form>
                        ` : `
                            <form action="/api-action/start/${key}" method="POST" style="display:inline;"><button type="submit" class="btn-action btn-start">START</button></form>
                        `}
                        <form action="/api-action/delete/${key}" method="POST" style="display:inline;" onsubmit="return confirm('Bạn có chắc muốn xóa Web này vĩnh viễn?');"><button type="submit" class="btn-action btn-delete" style="background:#52525b;">XÓA</button></form>
                    </td>
                </tr>
            `;
        }
    });

    const msg = req.query.msg;

    res.send(baseHTML(`
        <section class="hero">
            <div class="hero-badge" style="border-color: var(--vs-gold); color: var(--vs-gold); background: rgba(234, 179, 8, 0.1);">VANTASHIELD CLOUD PLATFORM</div>
            <h1><span class="line2">TẠO WEB (HOSTING)</span></h1>
            <p style="color:#a1a1aa; font-family:'JetBrains Mono'; font-size:14px;">Khởi tạo API/Web từ kho Github hoặc tạo thủ công với Proxy bảo mật.</p>
        </section>

        ${msg ? `<div class="center-card-wrap"><div class="alert alert-success">${escapeHTML(msg)}</div></div>` : ''}

        <div class="center-card-wrap" style="max-width: 1000px; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
            
            <!-- OPTION 1: DEPLOY FROM GITHUB -->
            <div class="quick-card" style="padding: 25px;">
                <div class="field-label" style="color: var(--vs-cyan); font-size: 15px; margin-bottom: 20px; text-align:center;">
                    <span style="font-size: 20px;">🔗</span> DEPLOY TỪ GITHUB
                </div>
                <form id="githubForm" onsubmit="handleAjaxDeploy(event, 'github')">
                    <label class="field-label">TÊN DỰ ÁN WEB</label>
                    <input type="text" name="project_name" placeholder="vidu: my-github-web" required pattern="[a-z0-9-]+" title="Chữ thường, số và gạch ngang">
                    
                    <label class="field-label">LINK KHO GITHUB (Public)</label>
                    <input type="text" name="repo_url" placeholder="https://github.com/user/repo.git" required>
                    
                    <p style="font-size: 11px; color: #a1a1aa; margin-top: -5px; margin-bottom: 15px;">Hệ thống sẽ tự động git clone, chạy npm install và start server.js.</p>
                    
                    <button type="submit" class="btn-save" style="background: linear-gradient(135deg, #2ea043, #238636); margin-top: 10px;">DEPLOY TỪ GITHUB</button>
                </form>
            </div>

            <!-- OPTION 2: CREATE DIRECTLY -->
            <div class="quick-card" style="padding: 25px;">
                <div class="field-label" style="color: var(--vs-purple); font-size: 15px; margin-bottom: 20px; text-align:center;">
                    <span style="font-size: 20px;">⚡</span> TẠO TRỰC TIẾP TẠI WEB
                </div>
                <form id="manualForm" onsubmit="handleAjaxDeploy(event, 'manual')">
                    <label class="field-label">TÊN DỰ ÁN WEB</label>
                    <input type="text" name="project_name" placeholder="vidu: my-local-web" required pattern="[a-z0-9-]+" title="Chữ thường, số và gạch ngang">
                    
                    <label class="field-label" style="color: var(--vs-cyan);">package.json</label>
                    <textarea name="pkg_json" style="height: 100px; font-family: 'JetBrains Mono'; margin-bottom: 15px;">{
  "name": "my-web",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "express": "^4.19.2"
  }
}</textarea>
                    
                    <label class="field-label" style="color: var(--vs-gold);">server.js</label>
                    <textarea name="srv_js" style="height: 150px; font-family: 'JetBrains Mono'; margin-bottom: 15px;">const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('<h1>Web tạo thành công!</h1>'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running'));</textarea>
                    
                    <button type="submit" class="btn-save">TIẾN HÀNH TẠO WEB BẰNG TAY</button>
                </form>
            </div>
        </div>

        <div class="center-card-wrap" style="max-width: 1000px;">
            <div class="quick-card">
                <div class="field-label" style="margin-bottom: 15px;">CÁC WEB ĐANG HOẠT ĐỘNG CỦA BẠN</div>
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
                            ${rowsHtml || `<tr><td colspan="${isAdmin ? 5 : 4}" style="text-align:center; color:#52525b; padding: 20px;">Bạn chưa tạo web nào.</td></tr>`}
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
                    await appendTerm('<span style="color:var(--vs-green);">> NPM: Cài đặt hoàn tất!</span>', 0);
                    await appendTerm('> Server: Đang khởi động Node.js backend...', 800);
                    await appendTerm('<br><span style="color:var(--vs-gold); font-size:16px; font-weight:bold;">[ TẠO WEB THÀNH CÔNG ]</span>', 800);
                    await appendTerm('Link proxy: ' + window.location.origin + '/app/' + result.name, 500);
                    await appendTerm('Hệ thống tải lại trang sau 3 giây...', 1000);
                    
                    setTimeout(() => {
                        window.location.href = '/api-hosting?msg=Tạo web thành công!';
                    }, 3000);
                } else {
                    await appendTerm('<br><span style="color:var(--vs-red);">[ LỖI ] ' + result.message + '</span>', 0);
                    await appendTerm('<button onclick="document.getElementById(\\'loader-overlay\\').style.display=\\'none\\'" style="margin-top:15px; padding:8px; background:#ef4444; color:white; border:none; cursor:pointer;">ĐÓNG</button>', 0);
                }
            } catch (err) {
                await appendTerm('<br><span style="color:var(--vs-red);">[ LỖI MẠNG ] Không thể kết nối tới server.</span>', 0);
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
    
    // Bảo vệ và làm sạch URL GitHub
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

        // Tiến hành Clone Source
        exec(`git clone "${repo_url}" .`, { cwd: apiDir }, (errClone, stdoutC, stderrC) => {
            if (errClone) return res.json({ success: false, message: 'Không thể Clone GitHub. Repo có thể bị Private hoặc sai link.' });

            apisDb.set(apiId, { id: apiId, owner: user, name: project_name, port: port, status: 'OFFLINE', createdAt: Date.now() });
            saveApis();

            // Nếu có package.json thì chạy npm install, không thì chạy thẳng server.js
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

// Hàm Start Process chung cho tất cả
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
// 3. CHAT VN & CHAT GLOBAL
// ============================================================================
const chatTemplate = (title, badgeClass, welcomeMsg) => `
    <section class="hero">
        <div class="hero-badge ${badgeClass}">${title.toUpperCase()} SERVER</div>
        <h1><span class="line2">${title}</span></h1>
    </section>
    <div class="center-card-wrap" style="max-width: 800px;">
        <div class="chat-box">
            <div class="chat-messages" id="chatArea">
                <div class="chat-msg msg-bot">${welcomeMsg}</div>
            </div>
            <div class="chat-input-area">
                <button class="btn-attach" title="Attach File/Image" onclick="document.getElementById('fileUpload').click()">+</button>
                <input type="file" id="fileUpload" style="display:none" accept="image/*,video/*,.txt,.lua,.zip">
                <input type="text" class="chat-input" placeholder="Type your message here..." id="chatInput">
                <button class="btn-send" onclick="sendUI()">SEND</button>
            </div>
        </div>
    </div>
    <script>
        function sendUI() {
            const input = document.getElementById('chatInput');
            const val = input.value.trim();
            if(!val) return;
            const chatArea = document.getElementById('chatArea');
            chatArea.innerHTML += \`<div class="chat-msg msg-user">\${val}</div>\`;
            input.value = '';
            chatArea.scrollTop = chatArea.scrollHeight;
        }
    </script>
`;

app.get('/chat-vn', (req, res) => {
    const user = getCookie(req, 'user_session');
    res.send(baseHTML(chatTemplate('VN Chat', 'badge-vn', 'Chào mừng đến với máy chủ chat Việt Nam. Bạn có thể gửi file, ảnh và video bằng nút (+).'), user));
});

app.get('/chat-global', (req, res) => {
    const user = getCookie(req, 'user_session');
    res.send(baseHTML(chatTemplate('Global Chat', 'badge-global', 'Welcome to the Global Hub Chat. Use the (+) button to attach files, images, or videos.'), user));
});

// ============================================================================
// 4. CORE ROUTES (HOME, DASHBOARD, LOGIN, TOS, RAW V1)
// ============================================================================
app.get('/', (req, res) => {
    const user = getCookie(req, 'user_session');
    res.send(baseHTML(`
        <section class="hero">
            <div class="hero-badge">BRAND NEW RAW SYSTEM WITH ANTI-SKID</div>
            <h1><span class="line2">RAW HUB CODESHARE</span></h1>
        </section>
        <div class="center-card-wrap">
            <div class="quick-card">
                <form action="/create" method="POST">
                    <div class="header-flex">
                        <label class="field-label" style="margin: 0;">SCRIPT CONTENT (LUA / TXT)</label>
                        <label class="btn-upload">
                            📁 UPLOAD FILE...
                            <input type="file" accept=".lua,.txt,.luau,.js" onchange="handleFileUpload(event)">
                        </label>
                    </div>
                    <textarea id="codeArea" name="code" placeholder="-- Type your script here, or click [UPLOAD FILE] to insert code..." required></textarea>
                    <button type="submit" class="btn-save">SECURE & GENERATE RAW LINK</button>
                </form>
            </div>
        </div>
    `, user));
});

app.post('/create', (req, res) => {
    const user = getCookie(req, 'user_session') || 'guest_anonymous';
    const { code } = req.body;
    
    const id = crypto.randomBytes(4).toString('hex');
    db.set(id, { code, owner: user, createdAt: Date.now() });
    saveDb(); 
    
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const rawLink = `${protocol}://${host}/v1/${id}`;
    const loadstringCommand = `loadstring(game:HttpGet("${rawLink}"))()`;

    res.send(baseHTML(`
        <section class="hero"><h1><span class="line2">RAW GENERATED!</span></h1></section>
        <div class="center-card-wrap" style="max-width: 650px;">
            <div class="quick-card">
                <div class="result-box">
                    <div style="font-size: 11px; color: #a1a1aa; margin-bottom: 5px;">EXECUTOR LOADSTRING:</div>
                    <button type="button" class="copy-btn" onclick="copyText('loadstring-text', this)">COPY</button>
                    <div class="code-preview" id="loadstring-text">${loadstringCommand}</div>
                </div>
                <div style="text-align: center; margin-top: 20px; font-size: 13px;">
                    View Raw Link: <a href="${rawLink}" target="_blank" style="color: var(--vs-cyan); font-weight: bold;">${rawLink}</a>
                </div>
                <br>
                <a href="/" class="btn-save" style="background: rgba(6,182,212,0.1); border: 1px solid var(--vs-cyan);">CREATE ANOTHER</a>
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
                ${error ? `<div class="alert">${escapeHTML(error)}</div>` : ''}
                <form action="/register" method="POST">
                    <label class="field-label">USERNAME</label>
                    <input type="text" name="username" placeholder="Enter username..." required minlength="3">
                    <label class="field-label">PASSWORD</label>
                    <input type="password" name="password" placeholder="Enter password..." required minlength="4">
                    <button type="submit" class="btn-save" style="margin-top:10px;">REGISTER NOW</button>
                </form>
                <div style="text-align:center; margin-top:20px; font-size:13px; color:#a1a1aa;">
                    Already have an account? <a href="/login" style="color:var(--vs-cyan);">Login here</a>
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
                ${error ? `<div class="alert">${escapeHTML(error)}</div>` : ''}
                ${success ? `<div class="alert alert-success">${escapeHTML(success)}</div>` : ''}
                <form action="/login" method="POST">
                    <label class="field-label">USERNAME</label>
                    <input type="text" name="username" placeholder="Enter username..." required>
                    <label class="field-label">PASSWORD</label>
                    <input type="password" name="password" placeholder="Enter password..." required>
                    <button type="submit" class="btn-save" style="margin-top:10px;">ACCESS SYSTEM</button>
                </form>
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
        res.redirect('/dashboard');
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
                    <h2 style="color:var(--vs-red); font-family:'Orbitron'">ACCESS DENIED</h2>
                    <p style="color:#a1a1aa; font-size:14px; margin-bottom: 20px;">You must log in to access the script management panel.</p>
                    <a href="/login" class="btn-save">LOGIN NOW</a>
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
                    <td style="color:var(--vs-cyan); font-weight:bold;">${key}</td>
                    ${isAdmin ? `<td><span class="badge-admin">${val.owner.toUpperCase()}</span></td>` : ''}
                    <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color: #a5f3fc;">
                        ${escapeHTML(val.code.substring(0, 35))}...
                    </td>
                    <td>
                        <a href="/edit/${key}" class="btn-action btn-edit">EDIT</a>
                        <a href="/delete/${key}" class="btn-action btn-delete" onclick="return confirm('Confirm delete?')">DEL</a>
                        ${isAdmin ? `<a href="/download/${key}" class="btn-action btn-download">DL</a>` : ''}
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
                    ${isAdmin ? 'ALL SYSTEM SCRIPTS (Admin View)' : `CODES FOR [${escapeHTML(user.toUpperCase())}]:`}
                </div>
                <div style="margin-bottom: 20px; padding: 12px; background: rgba(0,0,0,0.5); border-radius: 8px; border-left: 4px solid ${isAdmin ? 'var(--vs-gold)' : 'var(--vs-cyan)'};">
                    ${isAdmin 
                        ? `<span style="font-size:12px; color:#a1a1aa;">* Admin Note: Admin scripts older than 7 days are automatically hidden.</span>`
                        : `<div class="cyber-text-alert">⚡ V1 PROTECTION: LAYER 7 ANTI-SKID FIREWALL ACTIVE.</div>`
                    }
                </div>
                <div class="manage-wrap">
                    <table class="manage-table">
                        <thead>
                            <tr>
                                <th>SCRIPT ID</th>
                                ${isAdmin ? '<th>OWNER</th>' : ''}
                                <th>PREVIEW</th>
                                <th>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml || `<tr><td colspan="${isAdmin ? 4 : 3}" style="text-align:center; color:#52525b; padding: 20px;">No scripts found.</td></tr>`}
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
    res.setHeader('Content-disposition', `attachment; filename=vantashield_${id}.lua`);
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

    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const rawLink = `${protocol}://${host}/v1/${id}`;
    const loadstringCommand = `loadstring(game:HttpGet("${rawLink}"))()`;

    res.send(baseHTML(`
        <section class="hero"><h1><span class="line2">EDIT SCRIPT [${id}]</span></h1></section>
        <div class="center-card-wrap">
            <div class="quick-card">
                <div class="result-box" style="margin-top: 0; margin-bottom: 25px; border-color: var(--vs-purple);">
                    <div style="font-size: 11px; color: var(--vs-cyan); margin-bottom: 5px; font-weight: bold; font-family: 'Orbitron';">LOADSTRING COMMAND:</div>
                    <button type="button" class="copy-btn" onclick="copyText('loadstring-text-edit', this)">COPY</button>
                    <div class="code-preview" id="loadstring-text-edit" style="color: #fff;">${loadstringCommand}</div>
                </div>
                <form action="/edit/${id}" method="POST">
                    <div style="background: rgba(168,85,247,0.1); padding: 15px; border-radius: 8px; border: 1px solid var(--vs-border); margin-bottom: 20px;">
                        <div class="field-label">METHOD 1: UPLOAD NEW FILE</div>
                        <p style="font-size: 12px; color: #a1a1aa; margin: 5px 0 10px 0;">Click below to overwrite current code with a local file.</p>
                        <label class="btn-upload" style="background: var(--vs-purple); color: white; border: none;">
                            📁 SELECT FILE...
                            <input type="file" accept=".lua,.txt,.luau,.js" onchange="handleFileUpload(event)">
                        </label>
                    </div>
                    <div class="field-label" style="margin-top: 20px;">METHOD 2: DIRECT EDIT</div>
                    <textarea id="codeArea" name="code" required>${escapeHTML(scriptData.code)}</textarea>
                    <button type="submit" class="btn-save">SAVE CHANGES TO SERVER</button>
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

// TOS
app.get('/tos', (req, res) => {
    const user = getCookie(req, 'user_session');
    res.send(baseHTML(`
        <section class="hero">
            <div class="hero-badge">LEGAL & COMPLIANCE</div>
            <h1><span class="line2">TERMS OF SERVICE</span></h1>
        </section>
        <div class="center-card-wrap" style="max-width: 800px;">
            <div class="quick-card">
                <div class="cyber-text-alert" style="text-align:center; margin-bottom: 20px;">LAST UPDATED: 2026</div>
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

// API RAW & ANTI SKID (V1 LAYER) - TROLL SCREEN
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[VantaShield.com] Secure Server is running on Port: ${PORT}`);
});
