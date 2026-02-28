import { escapeHtml, formatRelative } from '../utils.js';

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });
  it('escapes less-than and greater-than', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });
  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });
  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
  it('neutralises XSS payload', () => {
    const result = escapeHtml('<img src=x onerror="alert(1)">');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('"');
  });
});

describe('formatRelative', () => {
  function isoAgo(ms) {
    return new Date(Date.now() - ms).toISOString();
  }

  it('returns "just now" for < 60 seconds', () => {
    expect(formatRelative(isoAgo(30_000))).toBe('just now');
  });
  it('returns singular minute', () => {
    expect(formatRelative(isoAgo(60_000))).toBe('1 minute ago');
  });
  it('returns plural minutes', () => {
    expect(formatRelative(isoAgo(5 * 60_000))).toBe('5 minutes ago');
  });
  it('returns singular hour', () => {
    expect(formatRelative(isoAgo(60 * 60_000))).toBe('1 hour ago');
  });
  it('returns plural hours', () => {
    expect(formatRelative(isoAgo(3 * 60 * 60_000))).toBe('3 hours ago');
  });
  it('returns singular day', () => {
    expect(formatRelative(isoAgo(24 * 60 * 60_000))).toBe('1 day ago');
  });
  it('returns plural days', () => {
    expect(formatRelative(isoAgo(3 * 24 * 60 * 60_000))).toBe('3 days ago');
  });
});
