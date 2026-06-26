/* BC125AT Web Controller — socket.js
   SocketIO client — Phase 4 live push updates.

   Replaces the 600ms setInterval poll in main.js with zero-latency
   server-push events. The server emits 'scanner_state' on every poll
   cycle and 'scanner_error' on connection loss.

   Events received:
     scanner_state  — full state dict pushed from the poll thread
     scanner_error  — scanner disconnected or error

   Events sent:
     ping           — health check (server replies with pong)
*/

/* Socket is initialised after DOM is ready — see bottom of file. */
let socket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_LOG = 5;

/* ── Initialise ── */
function initSocket() {
  socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });

  /* ── Connection lifecycle ── */
  socket.on('connect', () => {
    reconnectAttempts = 0;
    setConnected(true);
    logEntry('WebSocket connected', 'ok');
  });

  socket.on('disconnect', (reason) => {
    setConnected(false);
    logEntry(`WebSocket disconnected — ${reason}`, 'err');
  });

  socket.on('connect_error', () => {
    if (reconnectAttempts < MAX_RECONNECT_LOG) {
      logEntry('WebSocket connection error — retrying...', 'err');
    }
    reconnectAttempts++;
  });

  socket.on('reconnect', (attempt) => {
    logEntry(`WebSocket reconnected after ${attempt} attempt(s)`, 'ok');
  });

  /* ── Scanner events ── */
  socket.on('scanner_state', (state) => {
    applyStatus(state);
  });

  socket.on('scanner_error', (data) => {
    setConnected(false);
    logEntry(`Scanner error — ${data.message}`, 'err');
  });

  socket.on('pong', () => {
    /* pong received — connection healthy */
  });
}

/* ── Health check ping every 30s ── */
function startPing() {
  setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('ping');
    }
  }, 30_000);
}

/* Expose for main.js */
window.initSocket = initSocket;
window.startPing  = startPing;
