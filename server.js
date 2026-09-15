const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, app: 'NEXORA' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const users = new Map();

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(obj) {
  const text = JSON.stringify(obj);
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(text);
}
function onlineUsers() {
  return [...users.values()]
    .filter(u => u.online)
    .map(u => ({ username: u.username, age: u.age, gender: u.gender }));
}
function broadcastUsers() { broadcast({ type: 'users', users: onlineUsers() }); }
function cleanUsername(v) { return String(v || '').trim().slice(0, 30); }

wss.on('connection', ws => {
  let username = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const type = msg.type;

    if (type === 'register' || type === 'login') {
      const u = cleanUsername(msg.username);
      const p = String(msg.password || '');
      if (!u || !p) return send(ws, { type: 'auth', ok: false, message: 'Username and password required.' });

      if (type === 'register') {
        if (users.has(u)) return send(ws, { type: 'auth', ok: false, message: 'Username already exists.' });
        users.set(u, {
          username: u,
          password: p,
          age: String(msg.age || ''),
          gender: String(msg.gender || ''),
          online: true,
          ws
        });
      } else {
        const user = users.get(u);
        if (!user) return send(ws, { type: 'auth', ok: false, message: 'Account not found. Register first.' });
        if (user.password !== p) return send(ws, { type: 'auth', ok: false, message: 'Wrong password.' });
        if (user.online && user.ws !== ws) {
          try { user.ws.close(); } catch {}
        }
        user.online = true;
        user.ws = ws;
      }

      username = u;
      ws.username = u;
      const user = users.get(u);
      send(ws, { type: 'auth', ok: true, user: { username: user.username, age: user.age, gender: user.gender } });
      broadcastUsers();
      return;
    }

    if (!username) return;

    if (type === 'signal') {
      const target = users.get(cleanUsername(msg.to));
      if (target && target.online) {
        send(target.ws, { type: 'signal', from: username, data: msg.data || {} });
      }
      return;
    }

    if (type === 'chat') {
      const text = String(msg.message || '').slice(0, 2000);
      if (!text.trim()) return;
      broadcast({ type: 'chat', from: username, message: text });
      return;
    }
  });

  ws.on('close', () => {
    if (!username) return;
    const u = users.get(username);
    if (u && u.ws === ws) {
      u.online = false;
      u.ws = null;
      broadcastUsers();
    }
  });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`NEXORA running on port ${PORT}`);
});
