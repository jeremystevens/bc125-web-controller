/* BC125AT Web Controller — socket.js
   SocketIO client — Phase 4 live push updates.

   Server uses async_mode='threading' (api/socket.py).
   Transport order: polling first then upgrade to websocket —
   more reliable with Werkzeug threading server on Windows.
*/

let socket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_LOG = 3;

function initSocket() {
  socket = io({
    // Polling first, then upgrade to WebSocket
    // More reliable with Werkzeug threading server
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    upgrade: true,
  });

  socket.on('connect', () => {
    reconnectAttempts = 0;
    setConnected(true);
    logEntry('WebSocket connected', 'ok');
  });

  socket.on('disconnect', (reason) => {
    setConnected(false);
    if (reason !== 'io server disconnect') {
      logEntry(`WebSocket disconnected — ${reason}`, 'err');
    }
  });

  socket.on('connect_error', (err) => {
    if (reconnectAttempts < MAX_RECONNECT_LOG) {
      logEntry(`Connection error — ${err.message}`, 'err');
    }
    reconnectAttempts++;
  });

  socket.on('reconnect', (attempt) => {
    logEntry(`Reconnected after ${attempt} attempt(s)`, 'ok');
  });

  socket.on('scanner_state', (state) => {
    applyStatus(state);
  });

  socket.on('scanner_error', (data) => {
    setConnected(false);
    logEntry(`Scanner error — ${data.message}`, 'err');
  });

  socket.on('pong', () => {
    /* connection healthy */
  });
}

/* Client ping every 20s — within server's 25s ping_interval */
function startPing() {
  setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('ping');
    }
  }, 20_000);
}

window.initSocket = initSocket;
window.startPing  = startPing;
