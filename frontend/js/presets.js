// ── PresetPopup ─────────────────────────────────────────────────────────────
// Dropdown popup attached to a button. Shows recently-used presets + "Open Editor…".

export class PresetPopup {
  constructor(buttonEl, { onInsert, onOpenEditor }) {
    this._btn = buttonEl;
    this._onInsert = onInsert;
    this._onOpenEditor = onOpenEditor;
    this._popup = null;
    this._open = false;

    this._btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._open) {
        this._close();
      } else {
        this._show();
      }
    });

    document.addEventListener('click', (e) => {
      if (this._open && !this._popup?.contains(e.target) && e.target !== this._btn) {
        this._close();
      }
    });
  }

  async _show() {
    if (!this._popup) {
      this._popup = document.createElement('div');
      this._popup.className = 'preset-popup';
      document.body.appendChild(this._popup);
    }

    this._popup.innerHTML = '';
    const itemsEl = document.createElement('div');
    itemsEl.id = 'preset-popup-items';
    this._popup.appendChild(itemsEl);

    const sep = document.createElement('div');
    sep.className = 'preset-popup-sep';
    this._popup.appendChild(sep);

    const openEl = document.createElement('div');
    openEl.className = 'preset-popup-item';
    openEl.textContent = 'Open Editor…';
    openEl.addEventListener('click', () => {
      this._close();
      this._onOpenEditor();
    });
    this._popup.appendChild(openEl);

    // Position below button.
    this._position();
    this._popup.style.display = 'block';
    this._open = true;

    // Load presets.
    let store = { presets: [], recentlyUsed: [] };
    try {
      const resp = await fetch('/api/presets');
      if (resp.ok) store = await resp.json();
    } catch (_) {}

    itemsEl.innerHTML = '';
    const recentIds = (store.recentlyUsed || []).slice(0, 10);
    const presetMap = Object.fromEntries((store.presets || []).map(p => [p.id, p]));
    const recent = recentIds.map(id => presetMap[id]).filter(Boolean);

    if (recent.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'preset-popup-empty';
      empty.textContent = 'No recent presets';
      itemsEl.appendChild(empty);
    } else {
      for (const p of recent) {
        const el = document.createElement('div');
        el.className = 'preset-popup-item';
        el.textContent = p.title || '(untitled)';
        el.addEventListener('click', () => {
          this._close();
          this._onInsert(p.content || '');
          fetch(`/api/presets/${p.id}/use`, { method: 'POST' }).catch(() => {});
        });
        itemsEl.appendChild(el);
      }
    }

    // Re-position after content renders (height may change).
    this._position();
  }

  _position() {
    if (!this._popup) return;
    const rect = this._btn.getBoundingClientRect();
    this._popup.style.position = 'fixed';
    this._popup.style.top = (rect.bottom + 4) + 'px';
    this._popup.style.left = rect.left + 'px';
    this._popup.style.minWidth = Math.max(rect.width, 180) + 'px';
  }

  _close() {
    if (this._popup) this._popup.style.display = 'none';
    this._open = false;
  }
}

// ── PresetEditor ────────────────────────────────────────────────────────────
// Full-screen dialog for creating, editing, reordering, and deleting presets.

export class PresetEditor {
  constructor({ showInsert = false, onInsert = null } = {}) {
    this._showInsert = showInsert;
    this._onInsert = onInsert;
    this._presets = [];
    this._recentlyUsed = [];
    this._selectedIndex = 0;
    this._cmView = null;
    this._overlay = null;
  }

  async open() {
    let store = { presets: [], recentlyUsed: [] };
    try {
      const resp = await fetch('/api/presets');
      if (resp.ok) store = await resp.json();
    } catch (_) {}

    this._presets = store.presets || [];
    this._recentlyUsed = store.recentlyUsed || [];

    if (this._presets.length === 0) {
      this._presets = [this._blankPreset()];
    }
    this._selectedIndex = 0;

    this._buildDOM();
    this._renderNav();
    this._loadPreset(0);
  }

  _blankPreset() {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : _uuid(),
      title: 'New Preset',
      content: '',
    };
  }

  _buildDOM() {
    this._overlay = document.createElement('div');
    this._overlay.className = 'preset-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'preset-dialog';

    // Nav (left)
    this._navEl = document.createElement('div');
    this._navEl.className = 'preset-nav';
    dialog.appendChild(this._navEl);

    // Editor panel (center)
    const edPanel = document.createElement('div');
    edPanel.className = 'preset-editor-panel';

    this._titleInput = document.createElement('input');
    this._titleInput.type = 'text';
    this._titleInput.className = 'preset-title-input';
    this._titleInput.placeholder = 'Preset title';
    this._titleInput.addEventListener('input', () => {
      if (this._presets[this._selectedIndex]) {
        this._presets[this._selectedIndex].title = this._titleInput.value || 'Untitled';
        this._updateNavItem(this._selectedIndex);
      }
    });
    edPanel.appendChild(this._titleInput);

    this._cmContainer = document.createElement('div');
    this._cmContainer.className = 'preset-cm-container';
    edPanel.appendChild(this._cmContainer);
    dialog.appendChild(edPanel);

    // Button bar (right)
    const btnBar = document.createElement('div');
    btnBar.className = 'preset-btn-bar';

    if (this._showInsert) {
      const insertBtn = this._makeBtn('Insert', async () => {
        this._saveCurrentToMemory();
        const content = this._presets[this._selectedIndex]?.content || '';
        if (this._onInsert) this._onInsert(content);
        const id = this._presets[this._selectedIndex]?.id;
        await this._saveToServer();
        if (id) fetch(`/api/presets/${id}/use`, { method: 'POST' }).catch(() => {});
        this._destroy();
      });
      btnBar.appendChild(insertBtn);
    }

    const deleteBtn = this._makeBtn('Delete', () => {
      if (this._presets.length === 0) return;
      this._presets.splice(this._selectedIndex, 1);
      if (this._presets.length === 0) {
        this._presets = [this._blankPreset()];
        this._selectedIndex = 0;
      } else {
        this._selectedIndex = Math.min(this._selectedIndex, this._presets.length - 1);
      }
      this._renderNav();
      this._loadPreset(this._selectedIndex);
    });
    btnBar.appendChild(deleteBtn);

    this._upBtn = this._makeBtn('Up', () => {
      if (this._selectedIndex === 0) return;
      this._saveCurrentToMemory();
      const i = this._selectedIndex;
      [this._presets[i - 1], this._presets[i]] = [this._presets[i], this._presets[i - 1]];
      this._selectedIndex--;
      this._renderNav();
      this._loadPreset(this._selectedIndex);
    });
    btnBar.appendChild(this._upBtn);

    this._downBtn = this._makeBtn('Down', () => {
      if (this._selectedIndex >= this._presets.length - 1) return;
      this._saveCurrentToMemory();
      const i = this._selectedIndex;
      [this._presets[i], this._presets[i + 1]] = [this._presets[i + 1], this._presets[i]];
      this._selectedIndex++;
      this._renderNav();
      this._loadPreset(this._selectedIndex);
    });
    btnBar.appendChild(this._downBtn);

    const newBtn = this._makeBtn('New', () => {
      this._saveCurrentToMemory();
      this._presets.push(this._blankPreset());
      this._selectedIndex = this._presets.length - 1;
      this._renderNav();
      this._loadPreset(this._selectedIndex);
    });
    btnBar.appendChild(newBtn);

    const closeBtn = this._makeBtn('Close', async () => {
      this._saveCurrentToMemory();
      await this._saveToServer();
      this._destroy();
    });
    closeBtn.style.marginTop = 'auto';
    btnBar.appendChild(closeBtn);

    dialog.appendChild(btnBar);
    this._overlay.appendChild(dialog);
    document.body.appendChild(this._overlay);

    // Mount CodeMirror.
    this._cmView = new CM.EditorView({
      state: CM.EditorState.create({ doc: '', extensions: this._makeExtensions() }),
      parent: this._cmContainer,
    });

    // Close on overlay click (outside dialog).
    this._overlay.addEventListener('click', async (e) => {
      if (e.target === this._overlay) {
        this._saveCurrentToMemory();
        await this._saveToServer();
        this._destroy();
      }
    });
  }

  _makeExtensions() {
    return [
      CM.lineNumbers(),
      CM.history(),
      CM.drawSelection(),
      CM.dropCursor(),
      CM.EditorState.allowMultipleSelections.of(true),
      CM.indentOnInput(),
      CM.syntaxHighlighting(CM.defaultHighlightStyle, { fallback: true }),
      CM.bracketMatching(),
      CM.rectangularSelection(),
      CM.crosshairCursor(),
      CM.highlightActiveLine(),
      CM.highlightSelectionMatches(),
      CM.keymap.of([
        ...CM.defaultKeymap,
        ...CM.historyKeymap,
        ...CM.searchKeymap,
      ]),
      CM.markdown({ base: CM.markdownLanguage, codeLanguages: CM.languages }),
      CM.oneDark,
      CM.search({ top: true }),
      CM.EditorView.lineWrapping,
    ];
  }

  _makeBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'editor-btn preset-editor-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  _renderNav() {
    this._navEl.innerHTML = '';
    for (let i = 0; i < this._presets.length; i++) {
      const p = this._presets[i];
      const el = document.createElement('div');
      el.className = 'preset-nav-item' + (i === this._selectedIndex ? ' selected' : '');
      el.textContent = p.title || '(untitled)';
      el.dataset.index = i;
      el.addEventListener('click', () => {
        this._saveCurrentToMemory();
        this._selectPreset(i);
      });
      this._navEl.appendChild(el);
    }
    this._updateNavButtons();
  }

  _updateNavItem(index) {
    const items = this._navEl.querySelectorAll('.preset-nav-item');
    if (items[index]) {
      items[index].textContent = this._presets[index]?.title || '(untitled)';
    }
  }

  _updateNavButtons() {
    if (this._upBtn) this._upBtn.disabled = this._selectedIndex === 0;
    if (this._downBtn) this._downBtn.disabled = this._selectedIndex >= this._presets.length - 1;
  }

  _selectPreset(index) {
    this._selectedIndex = index;
    const items = this._navEl.querySelectorAll('.preset-nav-item');
    items.forEach((el, i) => {
      el.classList.toggle('selected', i === index);
    });
    this._loadPreset(index);
    this._updateNavButtons();
  }

  _loadPreset(index) {
    const p = this._presets[index];
    if (!p || !this._cmView) return;
    this._titleInput.value = p.title || '';
    this._cmView.setState(CM.EditorState.create({
      doc: p.content || '',
      extensions: this._makeExtensions(),
    }));
    this._updateNavButtons();
  }

  _saveCurrentToMemory() {
    const p = this._presets[this._selectedIndex];
    if (!p || !this._cmView) return;
    p.content = this._cmView.state.doc.toString();
    p.title = this._titleInput.value || 'Untitled';
  }

  async _saveToServer() {
    try {
      const resp = await fetch('/api/presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presets: this._presets,
          recentlyUsed: this._recentlyUsed,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch (err) {
      console.error('Failed to save presets:', err);
      this._showSaveError();
    }
  }

  _showSaveError() {
    if (!this._overlay) return;
    let bar = this._overlay.querySelector('.preset-save-error');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'preset-save-error';
      this._overlay.querySelector('.preset-dialog').appendChild(bar);
    }
    bar.textContent = 'Save failed — changes may not persist';
    bar.style.display = 'block';
    clearTimeout(this._saveErrorTimer);
    this._saveErrorTimer = setTimeout(() => { bar.style.display = 'none'; }, 4000);
  }

  _destroy() {
    if (this._cmView) {
      this._cmView.destroy();
      this._cmView = null;
    }
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
  }
}

function _uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
