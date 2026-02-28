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
  } catch (_) {
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

// Build WebSocket URL
const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${proto}//${window.location.host}/api/sessions/${sessionId}/ws`;
const ws = new WebSocket(wsUrl);

window.getSessionName = () => currentSessionName;

window.pasteToTerminal = (text) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data: btoa(unescape(encodeURIComponent(text))) }));
  }
};

ws.onopen = () => {
  // Send initial resize once terminal is ready
  adapter.onResize((cols, rows) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });

  adapter.onData((text) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: btoa(text) }));
    }
  });
};

ws.onmessage = (event) => {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch (_) {
    return;
  }

  if (msg.type === 'output') {
    // Decode base64 output and write to terminal
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
    adapter.dispose();
    document.getElementById('ws-disconnected').style.display = 'flex';
  }
};

ws.onerror = (err) => {
  console.error('WebSocket error:', err);
};

window.addEventListener('beforeunload', () => {
  pageUnloading = true;
  ws.close();
});

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
