const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 10000;
const rooms = new Map();

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
  }
}));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function id() {
  let value;
  do value = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  while (rooms.has(value));
  return value;
}
function token() { return crypto.randomBytes(20).toString('hex'); }
function safeSend(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function gameResult(room) {
  if (room.result) return room.result;
  const c = room.chess;
  if (!c.isGameOver()) return null;
  if (c.isCheckmate()) return c.turn() === 'w' ? 'Black wins by checkmate' : 'White wins by checkmate';
  if (c.isStalemate()) return 'Draw by stalemate';
  if (c.isInsufficientMaterial()) return 'Draw by insufficient material';
  if (c.isThreefoldRepetition()) return 'Draw by repetition';
  if (c.isDraw()) return 'Draw';
  return 'Game over';
}
function serializedState(room) {
  const history = room.chess.history({ verbose: true }).map(m => ({
    from: m.from, to: m.to, san: m.san, color: m.color, piece: m.piece,
    captured: m.captured || null, promotion: m.promotion || null
  }));
  return {
    fen: room.chess.fen(),
    turn: room.chess.turn(),
    check: room.chess.isCheck(),
    gameOver: !!gameResult(room),
    result: gameResult(room),
    history,
    whiteConnected: !!room.white.ws,
    blackConnected: !!room.black.ws,
    rematchWhite: room.rematch.has('w'),
    rematchBlack: room.rematch.has('b')
  };
}
function sendState(room) {
  room.lastActive = Date.now();
  for (const side of ['white','black']) {
    const slot = room[side];
    safeSend(slot.ws, { type: 'state', room: room.id, color: side === 'white' ? 'w' : 'b', state: serializedState(room) });
  }
  for (const ws of room.spectators) safeSend(ws, { type: 'state', room: room.id, color: null, state: serializedState(room) });
}
function attach(ws, room, color) {
  ws.roomId = room.id;
  ws.playerColor = color;
  if (color === 'w') room.white.ws = ws;
  else if (color === 'b') room.black.ws = ws;
  else room.spectators.add(ws);
}
function detach(ws) {
  if (!ws.roomId) return;
  const room = rooms.get(ws.roomId);
  if (!room) return;
  if (ws.playerColor === 'w' && room.white.ws === ws) room.white.ws = null;
  else if (ws.playerColor === 'b' && room.black.ws === ws) room.black.ws = null;
  else room.spectators.delete(ws);
  sendState(room);
}
function joinRoom(ws, roomId, suppliedToken) {
  const room = rooms.get(String(roomId || '').toUpperCase());
  if (!room) return safeSend(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'That game room no longer exists. Create a new game.' });
  detach(ws);
  let color = null;
  let assignedToken = suppliedToken || '';
  if (suppliedToken && suppliedToken === room.white.token) color = 'w';
  else if (suppliedToken && suppliedToken === room.black.token) color = 'b';
  else if (!room.black.token) {
    color = 'b';
    assignedToken = token();
    room.black.token = assignedToken;
  }
  attach(ws, room, color);
  safeSend(ws, { type: 'joined', room: room.id, color, token: color ? assignedToken : null });
  sendState(room);
}

wss.on('connection', (ws) => {
  safeSend(ws, { type: 'hello' });
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'create') {
      detach(ws);
      const roomId = id();
      const whiteToken = token();
      const room = {
        id: roomId,
        chess: new Chess(),
        white: { token: whiteToken, ws: null },
        black: { token: null, ws: null },
        spectators: new Set(),
        result: null,
        rematch: new Set(),
        createdAt: Date.now(),
        lastActive: Date.now()
      };
      rooms.set(roomId, room);
      attach(ws, room, 'w');
      safeSend(ws, { type: 'created', room: roomId, color: 'w', token: whiteToken });
      sendState(room);
      return;
    }

    if (msg.type === 'join') return joinRoom(ws, msg.room, msg.token);
    const room = rooms.get(ws.roomId);
    if (!room) return safeSend(ws, { type: 'error', message: 'Open or create a game first.' });

    if (msg.type === 'move') {
      const color = ws.playerColor;
      if (!color) return safeSend(ws, { type: 'error', message: 'Spectators cannot move pieces.' });
      if (gameResult(room)) return safeSend(ws, { type: 'error', message: 'This game is already over.' });
      if (room.chess.turn() !== color) return safeSend(ws, { type: 'error', message: 'It is not your turn.' });
      try {
        const move = room.chess.move({ from: String(msg.from || ''), to: String(msg.to || ''), promotion: String(msg.promotion || 'q') });
        if (!move) throw new Error('Illegal move');
        room.rematch.clear();
        sendState(room);
      } catch {
        safeSend(ws, { type: 'error', message: 'That move is not legal.' });
      }
      return;
    }

    if (msg.type === 'resign') {
      if (!ws.playerColor || gameResult(room)) return;
      room.result = ws.playerColor === 'w' ? 'Black wins — White resigned' : 'White wins — Black resigned';
      sendState(room);
      return;
    }

    if (msg.type === 'rematch') {
      if (!ws.playerColor) return;
      room.rematch.add(ws.playerColor);
      if (room.rematch.has('w') && room.rematch.has('b')) {
        room.chess = new Chess();
        room.result = null;
        room.rematch.clear();
      }
      sendState(room);
      return;
    }
  });
  ws.on('close', () => detach(ws));
  ws.on('error', () => detach(ws));
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [roomId, room] of rooms) {
    if (room.lastActive < cutoff && !room.white.ws && !room.black.ws && room.spectators.size === 0) rooms.delete(roomId);
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => console.log(`Two Player Chess listening on ${PORT}`));
