import { escapeHtml, formatRelative } from '/js/utils.js';
import { PresetEditor } from '/js/presets.js';

const tbody = document.getElementById('sessions-tbody');
const emptyState = document.getElementById('empty-state');
const newSessionBtn = document.getElementById('new-session-btn');
const modal = document.getElementById('modal');
const modalCancel = document.getElementById('modal-cancel');
const modalCreate = document.getElementById('modal-create');
const modalInput = document.getElementById('modal-input');
const modalError = document.getElementById('modal-error');

async function loadSessions() {
  let sessions = [];
  try {
    const resp = await fetch('/api/sessions');
    if (resp.ok) {
      sessions = await resp.json();
    }
  } catch (_) {}

  tbody.innerHTML = '';

  if (!sessions || sessions.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  // Sort by created_at descending
  sessions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  for (const s of sessions) {
    const tr = document.createElement('tr');
    const statusDot = s.connected
      ? '<span class="dot dot-connected" title="Connected">&#9679;</span> connected'
      : '<span class="dot dot-idle" title="Idle">&#9679;</span> idle';

    tr.innerHTML = `
      <td>${escapeHtml(s.name)}</td>
      <td>${formatRelative(s.created_at)}</td>
      <td>${formatRelative(s.last_active)}</td>
      <td>${statusDot}</td>
      <td>
        <button class="btn btn-connect" data-id="${s.id}">Connect</button>
        <button class="btn btn-kill btn-danger" data-id="${s.id}">Kill</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  document.querySelectorAll('.btn-connect').forEach(btn => {
    btn.addEventListener('click', () => {
      window.open(`/session/${btn.dataset.id}`, '_blank');
    });
  });

  document.querySelectorAll('.btn-kill').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/sessions/${btn.dataset.id}`, { method: 'DELETE' });
      loadSessions();
    });
  });
}

// Modal logic
newSessionBtn.addEventListener('click', () => {
  modalInput.value = '';
  modalError.textContent = '';
  modal.style.display = 'flex';
  modalInput.focus();
});

modalCancel.addEventListener('click', () => {
  modal.style.display = 'none';
});

modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.style.display = 'none';
});

modalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') modalCreate.click();
  if (e.key === 'Escape') modal.style.display = 'none';
});

modalCreate.addEventListener('click', async () => {
  const name = modalInput.value.trim();
  if (!name) {
    modalError.textContent = 'Session name is required.';
    return;
  }

  const resp = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

  if (resp.status === 409) {
    modalError.textContent = 'A session with that name already exists.';
    return;
  }
  if (!resp.ok) {
    modalError.textContent = 'Failed to create session.';
    return;
  }

  const session = await resp.json();
  modal.style.display = 'none';
  window.open(`/session/${session.id}`, '_blank');
  loadSessions();
});

document.getElementById('presets-btn').addEventListener('click', () => {
  new PresetEditor({ showInsert: false }).open();
});

// Initial load + auto-refresh
loadSessions();
setInterval(loadSessions, 5000);
