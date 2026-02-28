// TerminalAdapter wraps xterm.js behind a stable interface.
// Swap this file to change the underlying terminal library.
export class TerminalAdapter {
  constructor(options = {}) {
    this._options = options;
    this._term = null;
    this._fitAddon = null;
    this._resizeCallback = null;
    this._resizeObserver = null;
  }

  attach(element) {
    this._term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#000000',
      },
      allowProposedApi: true,
      ...this._options,
    });

    this._fitAddon = new FitAddon.FitAddon();
    this._term.loadAddon(this._fitAddon);
    this._term.loadAddon(new WebLinksAddon.WebLinksAddon());

    this._term.open(element);
    this._fitAddon.fit();

    this._resizeObserver = new ResizeObserver(() => {
      this._fitAddon.fit();
      if (this._resizeCallback) {
        this._resizeCallback(this._term.cols, this._term.rows);
      }
    });
    this._resizeObserver.observe(element);
  }

  write(data) {
    if (this._term) {
      this._term.write(data);
    }
  }

  onData(callback) {
    if (this._term) {
      this._term.onData(callback);
    }
  }

  onResize(callback) {
    this._resizeCallback = callback;
    if (this._term) {
      this._term.onResize(({ cols, rows }) => callback(cols, rows));
    }
  }

  resize(cols, rows) {
    if (this._term) {
      this._term.resize(cols, rows);
    }
    if (this._fitAddon) {
      this._fitAddon.fit();
    }
  }

  dispose() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    if (this._term) {
      this._term.dispose();
    }
  }
}
