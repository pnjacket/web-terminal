import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NoteEditor } from '../notes.js';

function makeCMMock() {
  const EditorView = vi.fn(() => ({
    state: { doc: { toString: vi.fn().mockReturnValue('') } },
    setState: vi.fn(),
  }));
  EditorView.lineWrapping = {};
  EditorView.updateListener = { of: vi.fn().mockReturnValue({}) };

  return {
    EditorState: {
      create: vi.fn().mockReturnValue({}),
      allowMultipleSelections: { of: vi.fn().mockReturnValue({}) },
      readOnly: { of: vi.fn().mockReturnValue({}) },
    },
    EditorView,
    lineNumbers: vi.fn().mockReturnValue({}),
    history: vi.fn().mockReturnValue({}),
    drawSelection: vi.fn().mockReturnValue({}),
    dropCursor: vi.fn().mockReturnValue({}),
    indentOnInput: vi.fn().mockReturnValue({}),
    syntaxHighlighting: vi.fn().mockReturnValue({}),
    defaultHighlightStyle: {},
    bracketMatching: vi.fn().mockReturnValue({}),
    rectangularSelection: vi.fn().mockReturnValue({}),
    crosshairCursor: vi.fn().mockReturnValue({}),
    highlightActiveLine: vi.fn().mockReturnValue({}),
    highlightSelectionMatches: vi.fn().mockReturnValue({}),
    keymap: { of: vi.fn().mockReturnValue({}) },
    defaultKeymap: [],
    historyKeymap: [],
    searchKeymap: [],
    markdown: vi.fn().mockReturnValue({}),
    markdownLanguage: {},
    languages: [],
    oneDark: {},
    search: vi.fn().mockReturnValue({}),
  };
}

function setupDOM() {
  document.body.innerHTML = `
    <div id="editor-tabs"></div>
    <div id="editor-area"></div>
    <button id="etn-send"></button>
    <button id="etn-copy"></button>
    <button id="etn-export"></button>
    <button id="etn-delete"></button>
    <button id="etn-insert" disabled></button>
    <div id="editor-confirm" style="display:none">
      <p id="editor-confirm-msg"></p>
      <button id="editor-confirm-cancel"></button>
      <button id="editor-confirm-ok"></button>
    </div>
  `;
}

beforeEach(() => {
  setupDOM();
  localStorage.clear();
  vi.stubGlobal('CM', makeCMMock());
  vi.stubGlobal('crypto', { randomUUID: () => Math.random().toString(36).slice(2) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('NoteEditor._load', () => {
  it('creates a default tab when localStorage is empty', () => {
    const ed = new NoteEditor('sess1', () => 'test');
    ed._load();
    expect(ed.data.tabs).toHaveLength(1);
    expect(ed.data.tabs[0].readonly).toBe(false);
    expect(ed.data.activeTabId).toBe(ed.data.tabs[0].id);
  });

  it('restores state from localStorage', () => {
    const tab = {
      id: 'tab-1',
      name: '20240101-09:00',
      content: 'saved content',
      readonly: false,
      createdAt: Date.now(),
    };
    localStorage.setItem(
      'wt:notes:sess1',
      JSON.stringify({ tabs: [tab], activeTabId: 'tab-1' })
    );

    const ed = new NoteEditor('sess1', () => 'test');
    ed._load();
    expect(ed.data.tabs).toHaveLength(1);
    expect(ed.data.tabs[0].content).toBe('saved content');
    expect(ed.data.activeTabId).toBe('tab-1');
  });

  it('falls back to a new tab on corrupt localStorage', () => {
    localStorage.setItem('wt:notes:sess1', 'not valid json{{{');
    const ed = new NoteEditor('sess1', () => 'test');
    ed._load();
    expect(ed.data.tabs).toHaveLength(1);
  });

  it('resets activeTabId when stored id is missing from tabs', () => {
    const tab = { id: 'real-tab', name: 'x', content: '', readonly: false, createdAt: 1 };
    localStorage.setItem(
      'wt:notes:sess1',
      JSON.stringify({ tabs: [tab], activeTabId: 'ghost-id' })
    );
    const ed = new NoteEditor('sess1', () => 'test');
    ed._load();
    expect(ed.data.activeTabId).toBe('real-tab');
  });
});

describe('NoteEditor._createTab', () => {
  it('prepends a new editable tab and sets it active', () => {
    const ed = new NoteEditor('sess1', () => 'test');
    ed.data = { tabs: [], activeTabId: null };

    const tab = ed._createTab();

    expect(tab.readonly).toBe(false);
    expect(tab.content).toBe('');
    expect(ed.data.tabs[0]).toBe(tab);
    expect(ed.data.activeTabId).toBe(tab.id);
  });
});

describe('NoteEditor._formatTimestamp', () => {
  it('formats a date as YYYYMMdd-HH:mm', () => {
    const ed = new NoteEditor('sess1', () => 'test');
    // Jan 15 2024, 09:05
    const d = new Date(2024, 0, 15, 9, 5);
    expect(ed._formatTimestamp(d)).toBe('20240115-09:05');
  });

  it('zero-pads single-digit month, day, hour and minute', () => {
    const ed = new NoteEditor('sess1', () => 'test');
    const d = new Date(2024, 1, 3, 4, 7); // Feb 3, 04:07
    expect(ed._formatTimestamp(d)).toBe('20240203-04:07');
  });
});

describe('NoteEditor.switchTab', () => {
  it('saves current content to the active tab and switches', () => {
    const ed = new NoteEditor('sess1', () => 'test');
    ed._load();

    const firstTabId = ed.data.activeTabId;
    const secondTab = {
      id: 'tab-2',
      name: 'second',
      content: '',
      readonly: false,
      createdAt: Date.now(),
    };
    ed.data.tabs.push(secondTab);

    // Mock view returning some content
    ed.view = {
      state: { doc: { toString: () => 'edited content' } },
      setState: vi.fn(),
    };

    ed.switchTab('tab-2');

    const first = ed.data.tabs.find(t => t.id === firstTabId);
    expect(first.content).toBe('edited content');
    expect(ed.data.activeTabId).toBe('tab-2');
  });

  it('does nothing when switching to the already-active tab', () => {
    const ed = new NoteEditor('sess1', () => 'test');
    ed._load();
    const original = ed.data.activeTabId;
    ed.switchTab(original); // no-op
    expect(ed.data.activeTabId).toBe(original);
  });
});

describe('NoteEditor.sendContent', () => {
  it('calls window.pasteToTerminal with current content', () => {
    const ed = new NoteEditor('sess1', () => 'test');
    ed._load();

    const paste = vi.fn();
    vi.stubGlobal('pasteToTerminal', paste);

    ed.view = {
      state: { doc: { toString: () => 'send me' } },
      setState: vi.fn(),
    };

    ed.sendContent();

    expect(paste).toHaveBeenCalledWith('send me');
  });

  it('marks the sent tab as readonly and creates a new editable tab', () => {
    const ed = new NoteEditor('sess1', () => 'test');
    ed._load();
    const sentTabId = ed.data.activeTabId;

    vi.stubGlobal('pasteToTerminal', vi.fn());
    ed.view = {
      state: { doc: { toString: () => 'content' } },
      setState: vi.fn(),
    };

    ed.sendContent();

    const sentTab = ed.data.tabs.find(t => t.id === sentTabId);
    expect(sentTab.readonly).toBe(true);
    // New active tab is at front and is editable
    expect(ed.data.tabs[0].readonly).toBe(false);
  });

  it('does nothing when active tab is readonly', () => {
    const ed = new NoteEditor('sess1', () => 'test');
    ed._load();
    ed.data.tabs[0].readonly = true;

    const paste = vi.fn();
    vi.stubGlobal('pasteToTerminal', paste);
    ed.view = { state: { doc: { toString: () => 'x' } }, setState: vi.fn() };

    ed.sendContent();
    expect(paste).not.toHaveBeenCalled();
  });
});

describe('NoteEditor._doDeleteReadonly', () => {
  it('removes all readonly tabs, keeping editable ones', () => {
    const ed = new NoteEditor('sess1', () => 'test');
    ed.data = {
      tabs: [
        { id: '1', name: 'a', content: '', readonly: true, createdAt: 1 },
        { id: '2', name: 'b', content: '', readonly: false, createdAt: 2 },
        { id: '3', name: 'c', content: '', readonly: true, createdAt: 3 },
      ],
      activeTabId: '2',
    };
    ed.view = { setState: vi.fn() };

    ed._doDeleteReadonly();

    expect(ed.data.tabs).toHaveLength(1);
    expect(ed.data.tabs[0].id).toBe('2');
    expect(ed.data.activeTabId).toBe('2');
  });

  it('creates a new default tab when all tabs were readonly', () => {
    const ed = new NoteEditor('sess1', () => 'test');
    ed.data = {
      tabs: [{ id: '1', name: 'a', content: '', readonly: true, createdAt: 1 }],
      activeTabId: '1',
    };
    ed.view = { setState: vi.fn() };

    ed._doDeleteReadonly();

    expect(ed.data.tabs).toHaveLength(1);
    expect(ed.data.tabs[0].readonly).toBe(false);
  });

  it('resets activeTabId when the active tab was deleted', () => {
    const ed = new NoteEditor('sess1', () => 'test');
    ed.data = {
      tabs: [
        { id: '1', name: 'a', content: '', readonly: true, createdAt: 1 },
        { id: '2', name: 'b', content: '', readonly: false, createdAt: 2 },
      ],
      activeTabId: '1', // the one being deleted
    };
    ed.view = { setState: vi.fn() };

    ed._doDeleteReadonly();

    expect(ed.data.activeTabId).toBe('2');
  });
});
