import { escapeHtml, formatRelative } from '/js/utils.js';
import { TerminalAdapter } from '/js/terminal.js';

// Extract session id from URL path: /session/:id
const pathParts = window.location.pathname.split('/');
const sessionId = pathParts[pathParts.length - 1];
let currentSessionName = sessionId;
let sessionEnded = false;
let sessionDisplaced = false;
let pageUnloading = false;
let wsState = 'connected';   // 'connected' | 'reconnecting' | 'disconnected'
let lastSession = null;

if (!sessionId) {
  document.body.textContent = 'Invalid session URL.';
  throw new Error('Invalid session URL');
}

const statusBar = document.getElementById('status-bar');

function renderStatusBar(session) {
  lastSession = session;

  let statusDot;
  if (wsState === 'connected') {
    statusDot = '<span class="dot dot-connected" title="Connected">&#9679;</span> connected';
  } else if (wsState === 'reconnecting') {
    statusDot = '<span class="dot dot-reconnecting" title="Reconnecting">&#9679;</span> reconnecting\u2026';
  } else if (sessionDisplaced) {
    statusDot = '<span class="dot dot-disconnected" title="Displaced">&#9679;</span> opened in another tab';
  } else {
    statusDot = '<span class="dot dot-disconnected" title="Disconnected">&#9679;</span> disconnected';
  }

  const reconnectBtn = wsState === 'disconnected' && !sessionDisplaced
    ? '<button class="btn btn-primary" id="status-reconnect-btn">Reconnect</button>'
    : '';

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
    <div style="display:flex;align-items:center;gap:6px">
      ${reconnectBtn}
      <button class="btn btn-danger" id="status-kill-btn">Kill</button>
    </div>
  `;

  if (wsState === 'disconnected' && !sessionDisplaced) {
    document.getElementById('status-reconnect-btn').addEventListener('click', () => {
      location.reload();
    });
  }

  document.getElementById('status-kill-btn').addEventListener('click', async () => {
    await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    window.close();
    // Fallback: if tab wasn't opened by script, navigate home
    setTimeout(() => { window.location.href = '/'; }, 200);
  });
}

function setWsState(state) {
  wsState = state;
  if (lastSession) renderStatusBar(lastSession);
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
adapter.focus();

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

window.focusTerminal = () => {
  adapter.focus();
};

window.pasteToTerminal = (text) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data: btoa(unescape(encodeURIComponent(text))) }));
  }
};

// WebSocket with auto-reconnect
let ws = null;
let reconnectAttempts = 0;
let hasConnectedOnce = false;
let replayDone = false;
const MAX_RECONNECT = 10;

function connect() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${window.location.host}/api/sessions/${sessionId}/ws`);

  ws.onopen = () => {
    reconnectAttempts = 0;
    setWsState('connected');
    // On reconnect, save viewport position then clear the terminal before
    // scrollback replay to avoid duplicating content that is already on screen.
    if (hasConnectedOnce) {
      adapter.saveViewportPosition();
      adapter.write('\x1b[H\x1b[2J\x1b[3J');
    }
    hasConnectedOnce = true;
    replayDone = false;
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
      if (!replayDone) {
        // First output message after connect is the scrollback replay.
        // Once xterm finishes processing it, restore the viewport position.
        replayDone = true;
        adapter.write(bytes, () => adapter.restoreViewportPosition());
      } else {
        adapter.write(bytes);
      }
    } else if (msg.type === 'displaced') {
      sessionDisplaced = true;
      setWsState('disconnected');
    } else if (msg.type === 'closed') {
      sessionEnded = true;
      document.getElementById('session-ended').style.display = 'flex';
      adapter.dispose();
    }
  };

  ws.onclose = () => {
    if (!sessionEnded && !sessionDisplaced && !pageUnloading) {
      scheduleReconnect();
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT) {
    setWsState('disconnected');
    return;
  }

  const delay = Math.min(1000 * (2 ** reconnectAttempts), 10000);
  reconnectAttempts++;
  setWsState('reconnecting');

  setTimeout(connect, delay);
}

connect();

// Resizable split (mouse + touch, horizontal + vertical)
const resizer = document.getElementById('resizer');
const layout = document.querySelector('.session-layout');
const mobileQuery = window.matchMedia('(max-width: 768px)');

function startResize() {
  const vertical = mobileQuery.matches;
  document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
  document.body.style.userSelect = 'none';
  resizer.classList.add('dragging');

  function onMove(clientX, clientY) {
    const rect = layout.getBoundingClientRect();
    if (vertical) {
      const pct = ((clientY - rect.top) / rect.height) * 100;
      layout.style.setProperty('--terminal-split-v', Math.min(Math.max(pct, 15), 85) + '%');
    } else {
      const pct = ((clientX - rect.left) / rect.width) * 100;
      layout.style.setProperty('--terminal-split', Math.min(Math.max(pct, 15), 85) + '%');
    }
  }

  function onMouseMove(e) { onMove(e.clientX, e.clientY); }
  function onTouchMove(e) { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }

  function onEnd() {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    resizer.classList.remove('dragging');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onEnd);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onEnd);
}

resizer.addEventListener('mousedown', (e) => { e.preventDefault(); startResize(); });
resizer.addEventListener('touchstart', (e) => { e.preventDefault(); startResize(); }, { passive: false });

// Editor toggle (collapse / expand)
const toggleBtn = document.getElementById('editor-toggle');

function updateToggleArrow() {
  const collapsed = layout.classList.contains('layout-collapsed');
  if (mobileQuery.matches) {
    toggleBtn.textContent = collapsed ? '\u25B4' : '\u25BE';
  } else {
    toggleBtn.textContent = collapsed ? '\u2039' : '\u203A';
  }
}

toggleBtn.addEventListener('click', () => {
  layout.classList.toggle('layout-collapsed');
  updateToggleArrow();
});

mobileQuery.addEventListener('change', updateToggleArrow);
updateToggleArrow();

window.addEventListener('beforeunload', () => {
  pageUnloading = true;
  if (ws) ws.close();
});
