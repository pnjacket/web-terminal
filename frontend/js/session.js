import { escapeHtml, formatRelative } from '/js/utils.js';
import { TerminalAdapter } from '/js/terminal.js';

// Extract session id from URL path: /session/:id
const pathParts = window.location.pathname.split('/');
const sessionId = pathParts[pathParts.length - 1];
let currentSessionName = sessionId;
let sessionEnded = false;
let pageUnloading = false;

if (!sessionId) {
  document.body.textContent = 'Invalid session URL.';
  throw new Error('Invalid session URL');
}

const statusBar = document.getElementById('status-bar');
const disconnectedOverlay = document.getElementById('ws-disconnected');

function renderStatusBar(session) {
  const statusDot = session.connected
    ? '<span class="dot dot-connected" title="Connected">&#9679;</span> connected'
    : '<span class="dot dot-idle" title="Idle">&#9679;</span> idle';

  statusBar.innerHTML = `
    <div class="status-bar-meta">
      <span class="status-bar-name">${escapeHtml(session.name)}</span>
      <span class="status-bar-sep">|</span>
      <span>created ${formatRelative(session.created_at)}</span>
      <span class="status-bar-sep">|</span>
      <span>last active ${formatRelative(session.last_active)}</span>
      <span class="status-bar-sep">|</span>
      <span>${statusDot}</span>
    </div>
    <button class="btn btn-danger" id="status-kill-btn">Kill</button>
  `;

  document.getElementById('status-kill-btn').addEventListener('click', async () => {
    await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    window.close();
    // Fallback: if tab wasn't opened by script, navigate home
    setTimeout(() => { window.location.href = '/'; }, 200);
  });
}

async function loadStatus() {
  try {
    const resp = await fetch('/api/sessions');
    if (resp.ok) {
      const sessions = await resp.json();
      const session = sessions.find(s => s.id === sessionId);
      if (session) {
        currentSessionName = session.name;
        document.title = session.name;
        renderStatusBar(session);
      }
    }
  } catch {
    // Non-fatal
  }
}

// Initial load + auto-refresh
await loadStatus();
setInterval(loadStatus, 5000);

// Attach terminal adapter
const container = document.getElementById('terminal-container');
const adapter = new TerminalAdapter();
adapter.attach(container);

// Track the current terminal size so we can resend it after a reconnect.
let lastSize = null;

// Register adapter event callbacks once — outside connect() to avoid
// accumulating duplicate xterm.js listeners on every reconnect.
adapter.onResize((cols, rows) => {
  lastSize = { cols, rows };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
});

adapter.onData((text) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data: btoa(text) }));
  }
});

window.getSessionName = () => currentSessionName;

window.pasteToTerminal = (text) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data: btoa(unescape(encodeURIComponent(text))) }));
  }
};

// WebSocket with auto-reconnect
let ws = null;
let reconnectAttempts = 0;
let hasConnectedOnce = false;
const MAX_RECONNECT = 10;

function connect() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${window.location.host}/api/sessions/${sessionId}/ws`);

  ws.onopen = () => {
    reconnectAttempts = 0;
    disconnectedOverlay.style.display = 'none';
    // On reconnect, clear the terminal before scrollback replay to avoid
    // duplicating content that is already on screen.
    if (hasConnectedOnce) {
      adapter.write('\x1b[H\x1b[2J\x1b[3J');
    }
    hasConnectedOnce = true;
    // Resend current terminal size so the PTY matches after reconnect.
    if (lastSize) {
      ws.send(JSON.stringify({ type: 'resize', cols: lastSize.cols, rows: lastSize.rows }));
    }
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === 'output') {
      const binary = atob(msg.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      adapter.write(bytes);
    } else if (msg.type === 'closed') {
      sessionEnded = true;
      document.getElementById('session-ended').style.display = 'flex';
      adapter.dispose();
    }
  };

  ws.onclose = () => {
    if (!sessionEnded && !pageUnloading) {
      scheduleReconnect();
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT) {
    disconnectedOverlay.querySelector('p').textContent = 'Connection lost';
    disconnectedOverlay.querySelector('.session-ended-sub').textContent =
      'Could not reconnect to server.';
    disconnectedOverlay.querySelector('.btn').style.display = '';
    disconnectedOverlay.style.display = 'flex';
    return;
  }

  const delay = Math.min(1000 * (2 ** reconnectAttempts), 10000);
  reconnectAttempts++;

  disconnectedOverlay.querySelector('p').textContent = 'Reconnecting\u2026';
  disconnectedOverlay.querySelector('.session-ended-sub').textContent =
    `Attempt ${reconnectAttempts}\u2009/\u2009${MAX_RECONNECT}`;
  disconnectedOverlay.querySelector('.btn').style.display = 'none';
  disconnectedOverlay.style.display = 'flex';

  setTimeout(connect, delay);
}

connect();

// Resizable split
const resizer = document.getElementById('resizer');
const layout = document.querySelector('.session-layout');

resizer.addEventListener('mousedown', (e) => {
  e.preventDefault();
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  resizer.classList.add('dragging');

  function onMouseMove(e) {
    const rect = layout.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    layout.style.setProperty('--terminal-split', Math.min(Math.max(pct, 15), 85) + '%');
  }

  function onMouseUp() {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    resizer.classList.remove('dragging');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});

window.addEventListener('beforeunload', () => {
  pageUnloading = true;
  if (ws) ws.close();
});
