export class NoteEditor {
  constructor(sessionId, sessionNameGetter) {
    this.sessionId = sessionId;
    this.sessionNameGetter = sessionNameGetter;
    this.storageKey = `wt:notes:${sessionId}`;
    this.view = null;
    this.data = null; // { tabs: [], activeTabId: string }
  }

  init() {
    this._load();
    this._mountCodeMirror();
    this._renderTabs();
    this._bindToolbar();
    this._loadActiveTab();
    this._updateToolbar();
  }

  _load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        this.data = JSON.parse(raw);
        if (!Array.isArray(this.data.tabs) || this.data.tabs.length === 0) {
          throw new Error('invalid');
        }
        if (!this.data.tabs.find(t => t.id === this.data.activeTabId)) {
          this.data.activeTabId = this.data.tabs[0].id;
        }
        return;
      }
    } catch (_) {}
    this.data = { tabs: [], activeTabId: null };
    this._createTab();
  }

  _save() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.data));
  }

  _formatTimestamp(date) {
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${y}${mo}${d}-${h}:${mi}`;
  }

  _createTab() {
    const tab = {
      id: typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          }),
      name: this._formatTimestamp(new Date()),
      content: '',
      readonly: false,
      createdAt: Date.now(),
    };
    this.data.tabs.unshift(tab);
    this.data.activeTabId = tab.id;
    this._save();
    return tab;
  }

  _getActiveTab() {
    return this.data.tabs.find(t => t.id === this.data.activeTabId);
  }

  _saveCurrentContent() {
    const tab = this._getActiveTab();
    if (tab && this.view && !tab.readonly) {
      tab.content = this.view.state.doc.toString();
    }
  }

  _makeExtensions(readonly) {
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
      CM.EditorState.readOnly.of(readonly),
    ];
  }

  _mountCodeMirror() {
    const container = document.getElementById('editor-area');
    this.view = new CM.EditorView({
      state: CM.EditorState.create({ doc: '', extensions: this._makeExtensions(false) }),
      parent: container,
    });
  }

  _loadActiveTab() {
    const tab = this._getActiveTab();
    if (!tab || !this.view) return;
    this.view.setState(CM.EditorState.create({
      doc: tab.content,
      extensions: this._makeExtensions(tab.readonly),
    }));
  }

  _renderTabs() {
    const container = document.getElementById('editor-tabs');
    container.innerHTML = '';
    for (const tab of this.data.tabs) {
      const el = document.createElement('div');
      el.className = 'editor-tab' +
        (tab.id === this.data.activeTabId ? ' active' : '') +
        (tab.readonly ? ' readonly' : '');
      el.textContent = tab.name;
      el.dataset.id = tab.id;
      el.addEventListener('click', () => this.switchTab(tab.id));
      container.appendChild(el);
    }
  }

  switchTab(id) {
    if (id === this.data.activeTabId) return;
    this._saveCurrentContent();
    this.data.activeTabId = id;
    this._save();
    this._loadActiveTab();
    this._renderTabs();
    this._updateToolbar();
  }

  _updateToolbar() {
    const tab = this._getActiveTab();
    document.getElementById('etn-send').disabled = !tab || tab.readonly;
    document.getElementById('etn-delete').disabled = !this.data.tabs.some(t => t.readonly);
  }

  _bindToolbar() {
    document.getElementById('etn-send').addEventListener('click', () => this.sendContent());
    document.getElementById('etn-copy').addEventListener('click', () => this.copyContent());
    document.getElementById('etn-export').addEventListener('click', () => this.exportAll());
    document.getElementById('etn-delete').addEventListener('click', () => this.deleteReadonly());

    document.getElementById('editor-confirm-cancel').addEventListener('click', () => {
      document.getElementById('editor-confirm').style.display = 'none';
    });
    document.getElementById('editor-confirm-ok').addEventListener('click', () => {
      document.getElementById('editor-confirm').style.display = 'none';
      this._doDeleteReadonly();
    });
  }

  sendContent() {
    const tab = this._getActiveTab();
    if (!tab || tab.readonly) return;
    const content = this.view.state.doc.toString();
    tab.content = content;
    if (typeof window.pasteToTerminal === 'function') {
      window.pasteToTerminal(content);
    }
    tab.readonly = true;
    this._createTab();
    this._renderTabs();
    this._loadActiveTab();
    this._updateToolbar();
    this._save();
  }

  copyContent() {
    const content = this.view.state.doc.toString();
    navigator.clipboard.writeText(content).catch(console.error);
  }

  exportAll() {
    const sorted = this.data.tabs.slice().reverse(); // oldest first
    const joined = sorted.map(t => t.content).join('\n\n---\n\n');
    const sessionName = this.sessionNameGetter() ?? this.sessionId;
    const now = new Date();
    // Format: yyyymmdd-HHmm (no colon for filename safety)
    const ts = this._formatTimestamp(now).replace(':', '');
    const filename = `notes-${sessionName}-${ts}.md`;
    const blob = new Blob([joined], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  deleteReadonly() {
    const count = this.data.tabs.filter(t => t.readonly).length;
    if (count === 0) return;
    document.getElementById('editor-confirm-msg').textContent =
      `This will permanently delete ${count} read-only tab${count !== 1 ? 's' : ''}.`;
    document.getElementById('editor-confirm').style.display = 'flex';
  }

  prependContent(text) {
    const tab = this._getActiveTab();
    if (!tab || tab.readonly || !this.view) return;
    const existing = this.view.state.doc.toString();
    const newDoc = existing ? text + '\n' + existing : text;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: newDoc },
    });
    tab.content = newDoc;
    this._save();
  }

  _doDeleteReadonly() {
    this.data.tabs = this.data.tabs.filter(t => !t.readonly);
    if (this.data.tabs.length === 0) {
      this._createTab();
    } else if (!this.data.tabs.find(t => t.id === this.data.activeTabId)) {
      this.data.activeTabId = this.data.tabs[0].id;
    }
    this._renderTabs();
    this._loadActiveTab();
    this._updateToolbar();
    this._save();
  }
}

