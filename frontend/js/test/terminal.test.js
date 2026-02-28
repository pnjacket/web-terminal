import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { TerminalAdapter } from '../terminal.js';

describe('TerminalAdapter', () => {
  let mockTerm, mockFitAddon, mockResizeObserver;

  beforeEach(() => {
    mockTerm = {
      loadAddon: vi.fn(),
      open: vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      write: vi.fn(),
      cols: 80,
      rows: 24,
    };
    mockFitAddon = { fit: vi.fn() };
    mockResizeObserver = { observe: vi.fn(), disconnect: vi.fn() };

    vi.stubGlobal('Terminal', vi.fn(() => mockTerm));
    vi.stubGlobal('FitAddon', { FitAddon: vi.fn(() => mockFitAddon) });
    vi.stubGlobal('WebLinksAddon', { WebLinksAddon: vi.fn(() => ({})) });
    vi.stubGlobal('ResizeObserver', vi.fn(() => mockResizeObserver));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attach creates Terminal and FitAddon, opens and fits', () => {
    const adapter = new TerminalAdapter();
    const el = document.createElement('div');
    adapter.attach(el);

    expect(globalThis.Terminal).toHaveBeenCalledOnce();
    expect(mockTerm.loadAddon).toHaveBeenCalled();
    expect(mockTerm.open).toHaveBeenCalledWith(el);
    expect(mockFitAddon.fit).toHaveBeenCalled();
    expect(mockResizeObserver.observe).toHaveBeenCalledWith(el);
  });

  it('write delegates to term.write', () => {
    const adapter = new TerminalAdapter();
    adapter.attach(document.createElement('div'));
    const data = new Uint8Array([104, 105]);
    adapter.write(data);
    expect(mockTerm.write).toHaveBeenCalledWith(data);
  });

  it('write does nothing before attach', () => {
    const adapter = new TerminalAdapter();
    expect(() => adapter.write('hello')).not.toThrow();
  });

  it('onData registers callback on the terminal', () => {
    const adapter = new TerminalAdapter();
    adapter.attach(document.createElement('div'));
    const cb = vi.fn();
    adapter.onData(cb);
    expect(mockTerm.onData).toHaveBeenCalledWith(cb);
  });

  it('onResize stores callback and registers on the terminal', () => {
    const adapter = new TerminalAdapter();
    adapter.attach(document.createElement('div'));
    const cb = vi.fn();
    adapter.onResize(cb);
    expect(mockTerm.onResize).toHaveBeenCalled();
  });

  it('dispose disconnects ResizeObserver and disposes terminal', () => {
    const adapter = new TerminalAdapter();
    adapter.attach(document.createElement('div'));
    adapter.dispose();
    expect(mockResizeObserver.disconnect).toHaveBeenCalledOnce();
    expect(mockTerm.dispose).toHaveBeenCalledOnce();
  });

  it('dispose is safe before attach', () => {
    const adapter = new TerminalAdapter();
    expect(() => adapter.dispose()).not.toThrow();
  });
});
