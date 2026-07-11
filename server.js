const express = require('express');
const crypto = require('crypto');
const app = express();

// Cấu hình dung lượng tối đa cho Script lên đến 10MB
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Cơ sở dữ liệu tạm thời lưu trên RAM
const db = new Map();       // Lưu Script
const usersDb = new Map();  // Lưu Tài khoản người dùng

// KHỞI TẠO TÀI KHOẢN ADMIN MẶC ĐỊNH
usersDb.set('master1', { password: 'duykhanh2014' });

// Hàm tiện ích đọc Cookie
function getCookie(req, name) {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
}

// Chống tấn công XSS
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

// Phát hiện Roblox Executor siêu tốc
function isRobloxExecutor(req) {
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    return userAgent.includes('roblox') || userAgent.includes('rblx') || !userAgent.includes('mozilla');
}

// ============================================================================
// 1. STYLE & GIAO DIỆN CYBERPUNK
// ============================================================================
const style = `
<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Orbitron:wght@400;700;900&display=swap');

body.mobf-root {
  --mo-blue: #3b82f6; --mo-sky: #38bdf8; --mo-indigo: #6366f1; --mo-green: #22d3ee;
  --mo-bg: #050914; --mo-card: #0b1224; --mo-border: rgba(59, 130, 246, 0.18);
  background: var(--mo-bg); color: #dbe6ff;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  min-height: 100vh; margin: 0; overflow-x: hidden; position: relative;
}
.mobf-root::before {
  content: ""; position: fixed; inset: 0;
  background-image: linear-gradient(rgba(59, 130, 246, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(59, 130, 246, 0.05) 1px, transparent 1px);
  background-size: 40px 40px; animation: gridMove 20s linear infinite; pointer-events: none; z-index: 0;
}
@keyframes gridMove { to { transform: translateY(40px); } }

.orb { position: fixed; border-radius: 50%; filter: blur(80px); opacity: 0.18; pointer-events: none; z-index: 0; animation: orbFloat 8s ease-in-out infinite; }
.orb1 { width: 500px; height: 500px; background: var(--mo-blue); top: -150px; left: -100px; }
.orb2 { width: 400px; height: 400px; background: var(--mo-sky); bottom: -100px; right: -100px; animation-delay: -4s; }
@keyframes orbFloat { 0%,100%{ transform:translate(0,0);} 50%{ transform:translate(20px,-20px);} }

.mobf-nav {
  position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between;
  padding: 16px 32px; background: rgba(5, 9, 20, 0.85); backdrop-filter: blur(16px); border-bottom: 1px solid var(--mo-border);
}
.nav-logo {
  font-family: "Orbitron", sans-serif; font-size: 20px; font-weight: 900; letter-spacing: 2px;
  background: linear-gradient(135deg, var(--mo-sky), var(--mo-indigo));
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; text-decoration: none;
}
.menu-toggle {
  font-size: 24px; background: none; border: none; color: var(--mo-sky); cursor: pointer; transition: 0.3s;
}
.menu-toggle:hover { color: #fff; transform: scale(1.1); }

.sidebar {
  position: fixed; top: 0; left: -300px; width: 280px; height: 100vh; background: #070d1e;
  border-right: 1px solid var(--mo-border); z-index: 999; padding: 30px 20px; box-sizing: border-box;
  transition: all 0.4s cubic-bezier(0.77, 0, 0.175, 1); box-shadow: 10px 0 30px rgba(0,0,0,0.7);
}
.sidebar.active { left: 0; }
.sidebar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; font-family: "Orbitron"; font-weight: bold; color: var(--mo-sky); }
.sidebar-close { background: none; border: none; color: #f87171; font-size: 20px; cursor: pointer; }
.sidebar-menu a { display: block; padding: 14px 18px; color: #dbe6ff; text-decoration: none; border-radius: 8px; margin-bottom: 10px; transition: 0.3s; font-weight: bold;}
.sidebar-menu a:hover { background: rgba(59, 130, 246, 0.15); color: var(--mo-green); }
.user-badge { background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; font-size: 12px; margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.1); text-align: center;}

.hero { position: relative; z-index: 1; text-align: center; padding: 40px 20px 20px; max-width: 860px; margin: 0 auto; }
.hero-badge {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px; border: 1px solid rgba(59,130,246,0.35); border-radius: 20px;
  font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--mo-sky); margin-bottom: 20px; background: rgba(59,130,246,0.08);
}
.hero h1 { font-family: "Orbitron", sans-serif; font-size: clamp(26px, 5vw, 42px); font-weight: 900; letter-spacing: 2px; margin: 0 0 10px 0; }
.hero h1 .line2 { background: linear-gradient(135deg, var(--mo-sky), var(--mo-indigo)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }

.center-card-wrap { position: relative; z-index: 1; max-width: 800px; margin: 0 auto 80px; padding: 0 20px; }
.quick-card { background: var(--mo-card); border: 1px solid var(--mo-border); border-radius: 20px; padding: 32px; position: relative; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }

.header-flex { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;}
.field-label { font-size: 13px; letter-spacing: 2px; text-transform: uppercase; color: var(--mo-sky); font-weight: bold; margin: 0 0 10px 0; display: block;}

.quick-card input[type="text"], .quick-card input[type="password"] {
    width: 100%; padding: 14px; background: rgba(0,0,0,0.5); border: 1px solid rgba(59,130,246,0.3); border-radius: 10px; color: #7dd3fc; font-family: "JetBrains Mono", monospace; font-size: 14px; box-sizing: border-box; outline: none; transition: all .3s; margin-bottom: 20px;
}
.quick-card input:focus { border-color: var(--mo-sky); box-shadow: 0 0 20px rgba(59,130,246,0.3); }

.btn-upload {
    background: rgba(59,130,246,0.2); color: #7dd3fc; border: 1px dashed var(--mo-sky); 
    padding: 10px 15px; border-radius: 8px; font-size: 12px; cursor: pointer; transition: all 0.3s; font-family: "Orbitron"; display: inline-block; font-weight: bold;
}
.btn-upload:hover { background: rgba(59,130,246,0.6); color: #fff; }
input[type="file"] { display: none; }

.quick-card textarea { 
    width: 100%; height: 250px; background: rgba(0,0,0,0.5); border: 1px solid rgba(59,130,246,0.3); border-radius: 10px; color: #7dd3fc; font-family: "JetBrains Mono", monospace; font-size: 14px; padding: 14px; box-sizing: border-box; outline: none; transition: all .3s; resize: none; margin-bottom: 15px;
}
.quick-card textarea:focus { border-color: var(--mo-sky); box-shadow: 0 0 20px rgba(59,130,246,0.3); }

.btn-save { width: 100%; padding: 16px; border: none; border-radius: 12px; font-family: "Orbitron"; font-size: 15px; font-weight: 700; letter-spacing: 2px; cursor: pointer; color: #fff; background: linear-gradient(135deg, var(--mo-sky), var(--mo-blue), var(--mo-indigo)); background-size: 200% 200%; animation: gradShift 4s ease infinite; transition: all .2s; text-decoration:none; display:block; text-align:center; box-sizing:border-box;}
.btn-save:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(59,130,246,0.5); }
@keyframes gradShift { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }

.result-box { margin-top: 15px; padding: 20px; border-radius: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(59,130,246,0.4); text-align: left; position: relative;}
.copy-btn { position: absolute; top: 10px; right: 10px; background: var(--mo-indigo); color: white; border: none; padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer; font-family: "Orbitron"; transition: 0.3s; }
.copy-btn:hover { background: var(--mo-blue); }
.code-preview { color: #22d3ee; word-break: break-all; font-size: 13px; line-height: 1.5; margin-top: 10px; }

/* BẢNG QUẢN LÝ */
.manage-wrap { overflow-x: auto; width: 100%; }
.manage-table { width: 100%; min-width: 600px; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
.manage-table th { background: rgba(59,130,246,0.15); color: var(--mo-sky); padding: 12px; text-align: left; border-bottom: 1px solid var(--mo-border); font-family: "Orbitron"; }
.manage-table td { padding: 14px 12px; border-bottom: 1px solid rgba(59,130,246,0.08); vertical-align: middle; }
.btn-action { padding: 6px 10px; border: none; border-radius: 6px; font-family: "JetBrains Mono"; cursor: pointer; font-weight: bold; font-size: 11px; text-decoration: none; margin-right: 5px; display: inline-block; margin-bottom: 5px;}
.btn-edit { background: #eab308; color: #000; }
.btn-delete { background: #ef4444; color: #fff; }
.btn-download { background: #22c55e; color: #fff; }
.badge-admin { background: #eab308; color: #000; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; }

/* HIỆU ỨNG TEXT NGẦU */
.cyber-text-alert {
    font-family: 'Orbitron', sans-serif;
    font-size: 13px;
    font-weight: bold;
    color: #22d3ee;
    text-shadow: 0 0 8px rgba(34, 211, 238, 0.6);
    letter-spacing: 1px;
    animation: pulseGlow 2s infinite;
}
@keyframes pulseGlow {
    0%, 100% { opacity: 1; text-shadow: 0 0 8px rgba(34, 211, 238, 0.6); }
    50% { opacity: 0.8; text-shadow: 0 0 15px rgba(34, 211, 238, 1); }
}

/* TROLL SKID */
.troll-screen {
    position: fixed; inset: 0; z-index: 999999; background: #ff0000;
    display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;
}
.troll-text {
    font-family: 'Orbitron', sans-serif; font-size: clamp(38px, 8vw, 90px); font-weight: 900; color: #fff;
    text-shadow: 5px 5px 0px #000; animation: shake 0.1s infinite; margin-bottom: 15px;
}
.troll-sub { font-size: 20px; background: #000; color: yellow; padding: 12px 25px; font-weight: bold; border-radius: 8px; border: 2px solid white; }
@keyframes shake {
    0% { transform: translate(2px, 2px); } 50% { transform: translate(-2px, -2px); } 100% { transform: translate(2px, -2px); }
}

.alert { padding: 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #fca5a5; border-radius: 8px; margin-bottom: 20px; text-align: center; font-weight: bold; }
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
        btnElement.innerText = 'ĐÃ COPY!'; btnElement.style.background = '#22d3ee'; btnElement.style.color = '#000';
        setTimeout(() => { btnElement.innerText = 'SAO CHÉP'; btnElement.style.background = 'var(--mo-indigo)'; btnElement.style.color = '#fff'; }, 2000);
    } catch (err) { console.error(err); }
    document.body.removeChild(textArea);
}
</script>
`;

const baseHTML = (content, userSession = null) => {
    const isAdmin = userSession === 'master1';
    return `
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Doraemon Protected Raw Hub</title>
    ${style}
</head>
<body class="mobf-root">
    <div class="orb orb1"></div><div class="orb orb2"></div>
    
    <nav class="mobf-nav">
        <a href="/" class="nav-logo">DORAEMON RAW V2</a>
        <button class="menu-toggle" onclick="toggleSidebar()">☰</button>
    </nav>

    <div class="sidebar" id="sidebarNav">
        <div class="sidebar-header">
            <span>ĐIỀU HƯỚNG</span>
            <button class="sidebar-close" onclick="toggleSidebar()">✕</button>
        </div>
        ${userSession ? `
            <div class="user-badge">
                🟢 Đang vào bằng:<br> 
                <b style="color:${isAdmin ? '#eab308' : 'var(--mo-sky)'}; font-size: 16px;">
                    ${escapeHTML(userSession).toUpperCase()} ${isAdmin ? '👑' : ''}
                </b>
            </div>
            <div class="sidebar-menu">
                <a href="/">🏠 Trang Chủ Trình Tạo</a>
                <a href="/dashboard">📊 Quản Lý Hệ Script</a>
                <a href="/logout" style="color: #f87171; margin-top: 40px;">🚪 Đăng Xuất</a>
            </div>
        ` : `
            <div class="user-badge">🔴 Bạn chưa đăng nhập</div>
            <div class="sidebar-menu" style="text-align:center;">
                <p style="font-size:12px; color:#94a3b8; margin-bottom:15px;">Đăng nhập để lưu & sửa/xóa Script của bạn công khai</p>
                <a href="/login" style="background:var(--mo-indigo); color:#fff; font-size:13px; margin-bottom:10px;">🔑 Đăng Nhập</a>
                <a href="/register" style="background:var(--mo-sky); color:#000; font-size:13px;">📝 Đăng Ký Tài Khoản</a>
            </div>
        `}
    </div>

    <main>${content}</main>
</body>
</html>
`};

// ============================================================================
// 2. ROUTER & HỆ THỐNG
// ============================================================================

// --- ĐĂNG KÝ / ĐĂNG NHẬP ---
app.get('/register', (req, res) => {
    const error = req.query.error;
    res.send(baseHTML(`
        <section class="hero"><h1><span class="line2">TẠO TÀI KHOẢN MỚI</span></h1></section>
        <div class="center-card-wrap" style="max-width: 450px;">
            <div class="quick-card">
                ${error ? `<div class="alert">${escapeHTML(error)}</div>` : ''}
                <form action="/register" method="POST">
                    <label class="field-label">TÊN ĐĂNG NHẬP</label>
                    <input type="text" name="username" placeholder="Nhập tên tài khoản..." required minlength="3">
                    
                    <label class="field-label">MẬT KHẨU</label>
                    <input type="password" name="password" placeholder="Nhập mật khẩu..." required minlength="4">
                    
                    <button type="submit" class="btn-save" style="margin-top:10px;">ĐĂNG KÝ NGAY</button>
                </form>
                <div style="text-align:center; margin-top:20px; font-size:13px; color:#94a3b8;">
                    Đã có tài khoản? <a href="/login" style="color:var(--mo-sky);">Đăng nhập</a>
                </div>
            </div>
        </div>
    `));
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    const cleanUsername = username.trim().toLowerCase();
    
    if (cleanUsername === 'master1' || usersDb.has(cleanUsername)) {
        return res.redirect('/register?error=Tên đăng nhập đã tồn tại!');
    }
    
    usersDb.set(cleanUsername, { password });
    res.redirect('/login?success=Đăng ký thành công! Hãy đăng nhập.');
});

app.get('/login', (req, res) => {
    const error = req.query.error;
    const success = req.query.success;
    res.send(baseHTML(`
        <section class="hero"><h1><span class="line2">ĐĂNG NHẬP HỆ THỐNG</span></h1></section>
        <div class="center-card-wrap" style="max-width: 450px;">
            <div class="quick-card">
                ${error ? `<div class="alert">${escapeHTML(error)}</div>` : ''}
                ${success ? `<div class="alert" style="background:rgba(34,211,238,0.2); border-color:#22d3ee; color:#22d3ee;">${escapeHTML(success)}</div>` : ''}
                <form action="/login" method="POST">
                    <label class="field-label">TÊN ĐĂNG NHẬP</label>
                    <input type="text" name="username" placeholder="Nhập tên tài khoản..." required>
                    
                    <label class="field-label">MẬT KHẨU</label>
                    <input type="password" name="password" placeholder="Nhập mật khẩu..." required>
                    
                    <button type="submit" class="btn-save" style="margin-top:10px;">VÀO HỆ THỐNG</button>
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
        res.redirect('/login?error=Sai tài khoản hoặc mật khẩu!');
    }
});

app.get('/logout', (req, res) => {
    res.clearCookie('user_session');
    res.redirect('/');
});


// --- TẠO SCRIPT ---
app.get('/', (req, res) => {
    const user = getCookie(req, 'user_session');
    res.send(baseHTML(`
        <section class="hero">
            <div class="hero-badge">HỆ THỐNG RAW HOÀN TOÀN MỚI BẢO MẬT ANTI-SKID</div>
            <h1><span class="line2">RAW HUB CODESHARE</span></h1>
        </section>

        <div class="center-card-wrap">
            <div class="quick-card">
                <form action="/create" method="POST">
                    <div class="header-flex">
                        <label class="field-label" style="margin: 0;">NỘI DUNG SCRIPT (LUA / TXT)</label>
                        <label class="btn-upload">
                            📁 CHỌN FILE ĐỂ TẢI LÊN...
                            <input type="file" accept=".lua,.txt,.luau,.js" onchange="handleFileUpload(event)">
                        </label>
                    </div>
                    
                    <textarea id="codeArea" name="code" placeholder="-- Hãy gõ trực tiếp code script vào đây, hoặc bấm [TẢI FILE] từ máy để chèn code vào..." required></textarea>
                    <button type="submit" class="btn-save">BẢO MẬT & XUẤT LINK RAW</button>
                </form>
            </div>
        </div>
    `, user));
});

app.post('/create', (req, res) => {
    const user = getCookie(req, 'user_session') || 'guest_anonymous';
    const { code } = req.body;
    
    const id = crypto.randomBytes(4).toString('hex');
    // THÊM THỜI GIAN TẠO: Để đếm 7 ngày tự động xóa khỏi UI
    db.set(id, { code, owner: user, createdAt: Date.now() });
    
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    
    const rawLink = `${protocol}://${host}/v1/${id}`;
    const loadstringCommand = `loadstring(game:HttpGet("${rawLink}"))()`;

    res.send(baseHTML(`
        <section class="hero"><h1><span class="line2">TẠO RAW THÀNH CÔNG!</span></h1></section>
        <div class="center-card-wrap" style="max-width: 650px;">
            <div class="quick-card">
                <div class="result-box">
                    <div style="font-size: 11px; color: #94a3b8; margin-bottom: 5px;">MÃ EXECUTOR ĐỂ CHẠY TRONG GAME:</div>
                    <button type="button" class="copy-btn" onclick="copyText('loadstring-text', this)">SAO CHÉP</button>
                    <div class="code-preview" id="loadstring-text">${loadstringCommand}</div>
                </div>
                <div style="text-align: center; margin-top: 20px; font-size: 13px;">
                    Link xem Raw gốc: <a href="${rawLink}" target="_blank" style="color: var(--mo-sky); font-weight: bold;">${rawLink}</a>
                </div>
                <br>
                <a href="/" class="btn-save" style="background: rgba(59,130,246,0.1); border: 1px solid var(--mo-sky);">TẠO MÃ KHÁC</a>
            </div>
        </div>
    `, user === 'guest_anonymous' ? null : user));
});

// --- DASHBOARD: QUẢN LÝ TÀI KHOẢN & ADMIN ---
app.get('/dashboard', (req, res) => {
    const user = getCookie(req, 'user_session');
    if (!user) {
        return res.send(baseHTML(`
            <div class="center-card-wrap" style="margin-top:80px; max-width:500px; text-align:center;">
                <div class="quick-card">
                    <h2 style="color:#f87171; font-family:'Orbitron'">CẢNH BÁO TRUY CẬP</h2>
                    <p style="color:#94a3b8; font-size:14px; margin-bottom: 20px;">Bạn phải đăng nhập tài khoản qua menu 3 gạch để truy cập bảng quản lý Script.</p>
                    <a href="/login" class="btn-save">ĐĂNG NHẬP NGAY</a>
                </div>
            </div>
        `));
    }

    const isAdmin = user === 'master1';
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let rowsHtml = '';

    db.forEach((val, key) => {
        // TÍNH NĂNG 7 NGÀY: Ẩn các file tạo quá 7 ngày trên bảng quản trị (chỉ xóa ở web UI)
        const fileAge = now - (val.createdAt || now);
        if (fileAge > SEVEN_DAYS) return; // Bỏ qua không hiển thị

        // Nếu là Admin thì xem được toàn bộ. Nếu là User thường thì chỉ xem được của chính họ.
        if (isAdmin || val.owner === user) {
            rowsHtml += `
                <tr>
                    <td style="color:var(--mo-sky); font-weight:bold;">${key}</td>
                    ${isAdmin ? `<td><span class="badge-admin">${val.owner.toUpperCase()}</span></td>` : ''}
                    <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color: #a5f3fc;">
                        ${escapeHTML(val.code.substring(0, 35))}...
                    </td>
                    <td>
                        <a href="/edit/${key}" class="btn-action btn-edit">SỬA</a>
                        <a href="/delete/${key}" class="btn-action btn-delete" onclick="return confirm('Xác nhận xóa Script này?')">XÓA</a>
                        ${isAdmin ? `<a href="/download/${key}" class="btn-action btn-download">TẢI VỀ</a>` : ''}
                    </td>
                </tr>
            `;
        }
    });

    res.send(baseHTML(`
        <section class="hero">
            <h1><span class="line2">${isAdmin ? 'QUẢN LÝ HỆ THỐNG MASTER' : 'QUẢN LÝ SCRIPT'}</span></h1>
        </section>
        <div class="center-card-wrap" style="max-width: 900px;">
            <div class="quick-card">
                <div class="field-label" style="margin-bottom: 15px;">
                    ${isAdmin ? 'TẤT CẢ SCRIPT TRÊN HỆ THỐNG (Chỉ Admin mới thấy)' : `DANH SÁCH CODE CỦA TÀI KHOẢN [${escapeHTML(user.toUpperCase())}]:`}
                </div>
                
                <div style="margin-bottom: 20px; padding: 12px; background: rgba(0,0,0,0.3); border-radius: 8px; border-left: 4px solid ${isAdmin ? '#eab308' : '#22d3ee'};">
                    ${isAdmin 
                        ? `<span style="font-size:12px; color:#94a3b8;">* Lưu ý Admin: Các Script được tạo quá 7 ngày sẽ tự động bị ẩn khỏi danh sách này để tránh nặng web, nhưng đường link API v1 vẫn hoạt động bình thường.</span>`
                        : `<div class="cyber-text-alert">⚡ BẢO VỆ CODE V1: HỆ THỐNG TƯỜNG LỬA ANTI-SKID LỚP 7 ĐANG KÍCH HOẠT! MỌI HÀNH VI ĐÁNH CẮP SOURCE SẼ BỊ CHẶN ĐỨNG HOÀN TOÀN...</div>`
                    }
                </div>
                
                <div class="manage-wrap">
                    <table class="manage-table">
                        <thead>
                            <tr>
                                <th>ID SCRIPT</th>
                                ${isAdmin ? '<th>NGƯỜI TẠO</th>' : ''}
                                <th>XEM TRƯỚC SCRIPT</th>
                                <th>THAO TÁC</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml || `<tr><td colspan="${isAdmin ? 4 : 3}" style="text-align:center; color:#64748b; padding: 20px;">Hệ thống chưa có đoạn code script nào trong 7 ngày qua.</td></tr>`}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `, user));
});

// API Dành Riêng Cho ADMIN Tải File
app.get('/download/:id', (req, res) => {
    const user = getCookie(req, 'user_session');
    if (user !== 'master1') return res.status(403).send("Chỉ Admin mới có quyền thực hiện chức năng này.");
    
    const id = req.params.id;
    const scriptData = db.get(id);
    if (!scriptData) return res.status(404).send("File đã bị xóa hoặc không tồn tại.");

    res.setHeader('Content-disposition', `attachment; filename=script_${id}.lua`);
    res.setHeader('Content-type', 'text/plain; charset=utf-8');
    res.send(scriptData.code);
});

// Giao diện chỉnh sửa Script CÓ KHUNG LẤY LOADSTRING TRỰC TIẾP
app.get('/edit/:id', (req, res) => {
    const user = getCookie(req, 'user_session');
    const isAdmin = user === 'master1';
    const id = req.params.id;
    const scriptData = db.get(id);

    if (!scriptData || (!isAdmin && scriptData.owner !== user)) {
        return res.send("Quyền truy cập không hợp lệ hoặc script đã bị mất.");
    }

    // Tạo mã loadstring luôn cho người dùng lấy tại trang chỉnh sửa
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const rawLink = `${protocol}://${host}/v1/${id}`;
    const loadstringCommand = `loadstring(game:HttpGet("${rawLink}"))()`;

    res.send(baseHTML(`
        <section class="hero"><h1><span class="line2">CHỈNH SỬA SCRIPT [${id}]</span></h1></section>
        <div class="center-card-wrap">
            <div class="quick-card">
                
                <!-- BỔ SUNG: KHUNG LẤY NHANH LOADSTRING CHO SCRIPT ĐANG SỬA -->
                <div class="result-box" style="margin-top: 0; margin-bottom: 25px; border-color: var(--mo-indigo);">
                    <div style="font-size: 11px; color: #a5b4fc; margin-bottom: 5px; font-weight: bold; font-family: 'Orbitron';">MÃ EXECUTOR CỦA SCRIPT NÀY (LOADSTRING):</div>
                    <button type="button" class="copy-btn" onclick="copyText('loadstring-text-edit', this)">SAO CHÉP</button>
                    <div class="code-preview" id="loadstring-text-edit" style="color: #fff;">${loadstringCommand}</div>
                </div>

                <form action="/edit/${id}" method="POST">
                    <div style="background: rgba(59,130,246,0.1); padding: 15px; border-radius: 8px; border: 1px solid var(--mo-border); margin-bottom: 20px;">
                        <div class="field-label">PHƯƠNG THỨC 1: TẢI FILE MỚI ĐÈ LÊN</div>
                        <p style="font-size: 12px; color: #94a3b8; margin: 5px 0 10px 0;">Bấm nút dưới đây để chọn một file (.lua, .txt) từ máy tính/điện thoại, toàn bộ code cũ sẽ bị thay thế.</p>
                        <label class="btn-upload" style="background: var(--mo-indigo); color: white; border: none;">
                            📁 CHỌN FILE TỪ MÁY...
                            <input type="file" accept=".lua,.txt,.luau,.js" onchange="handleFileUpload(event)">
                        </label>
                    </div>

                    <div class="field-label" style="margin-top: 20px;">PHƯƠNG THỨC 2: CHỈNH SỬA TRỰC TIẾP CODE</div>
                    <textarea id="codeArea" name="code" required>${escapeHTML(scriptData.code)}</textarea>
                    
                    <button type="submit" class="btn-save">LƯU THAY ĐỔI VÀO SERVER</button>
                </form>
            </div>
        </div>
    `, user));
});

// Xử lý lưu sửa đổi
app.post('/edit/:id', (req, res) => {
    const user = getCookie(req, 'user_session');
    const isAdmin = user === 'master1';
    const id = req.params.id;
    const scriptData = db.get(id);

    if (scriptData && (isAdmin || scriptData.owner === user)) {
        scriptData.code = req.body.code;
        // Giữ nguyên ngày tạo gốc
        db.set(id, scriptData);
    }
    res.redirect('/dashboard');
});

// Xử lý xóa Script
app.get('/delete/:id', (req, res) => {
    const user = getCookie(req, 'user_session');
    const isAdmin = user === 'master1';
    const id = req.params.id;
    const scriptData = db.get(id);

    if (scriptData && (isAdmin || scriptData.owner === user)) {
        db.delete(id);
    }
    res.redirect('/dashboard');
});

// --- API TRẢ RAW & ANTI SKID ---
app.all('/v1/:id', (req, res) => {
    const id = req.params.id;
    const data = db.get(id);

    // Kể cả quá 7 ngày, miễn là data còn trong db thì vẫn trả raw mượt mà
    if (isRobloxExecutor(req)) {
        if (!data) {
            return res.status(404).send('print("Script Not Found / Server Restarted")');
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(data.code);
    }

    if (!data) {
        return res.send(`
            <!DOCTYPE html>
            <html lang="vi">
            <head><meta charset="UTF-8"><title>404 NOT FOUND</title>${style}</head>
            <body>
                <div class="troll-screen">
                    <div class="troll-text">SKID CỦ CẶC !</div>
                    <div class="troll-sub">Code không tồn tại hoặc đã bị bay màu rồi nha nhóc =)))</div>
                </div>
                <script>setTimeout(() => { window.location.href = "https://www.google.com"; }, 3000);</script>
            </body>
            </html>
        `);
    }

    return res.send(`
        <!DOCTYPE html>
        <html lang="vi">
        <head><meta charset="UTF-8"><title>SKID DETECTED !!!</title>${style}</head>
        <body>
            <div class="troll-screen">
                <div class="troll-text">SKID CỦ CẶC !</div>
                <div class="troll-sub">Cút ngay khỏi web! Muốn lấy trộm source code hả con trai?</div>
            </div>
            <script>setTimeout(() => { window.location.href = "https://www.google.com"; }, 3000);</script>
        </body>
        </html>
    `);
});

// Khởi chạy ứng dụng
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server Doraemon Raw Hub V2 dang chay tren Port: ${PORT}`);
});
