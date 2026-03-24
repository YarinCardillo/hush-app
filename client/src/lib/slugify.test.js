/**
 * Unit tests for slugify.js
 */

import { describe, it, expect } from 'vitest';
import { slugify, resolveGuildSlug } from './slugify';

// ── slugify ───────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('converts spaces to hyphens and lowercases', () => {
    expect(slugify('Gaming Hub')).toBe('gaming-hub');
  });

  it('trims leading and trailing whitespace', () => {
    expect(slugify('  My Server  ')).toBe('my-server');
  });

  it('returns "unnamed" for empty string', () => {
    expect(slugify('')).toBe('unnamed');
  });

  it('returns "unnamed" for whitespace-only string', () => {
    expect(slugify('   ')).toBe('unnamed');
  });

  it('collapses multiple spaces/hyphens into a single hyphen', () => {
    expect(slugify('My   Big   Server')).toBe('my-big-server');
    expect(slugify('my--server')).toBe('my-server');
  });

  it('strips characters that are not letters, numbers, or hyphens', () => {
    expect(slugify('Hello! World@123')).toBe('hello-world123');
  });

  it('strips leading and trailing hyphens produced by stripping', () => {
    expect(slugify('!Hello!')).toBe('hello');
  });

  it('truncates to 64 characters', () => {
    const long = 'a'.repeat(80);
    expect(slugify(long)).toHaveLength(64);
  });

  it('does not produce a trailing hyphen after truncation', () => {
    // 63 'a' chars + 'b' = 64 chars, no hyphen issue
    const long = 'a'.repeat(63) + '-extra';
    const result = slugify(long);
    expect(result.endsWith('-')).toBe(false);
  });

  it('handles Unicode letters (preserves accented chars)', () => {
    // Unicode letters like é, ü, ñ should be retained
    const result = slugify('Café au Lait');
    expect(result).toBe('café-au-lait');
  });

  it('handles a name that is pure non-letter characters', () => {
    expect(slugify('!!! ###')).toBe('unnamed');
  });

  it('handles numbers in the name', () => {
    expect(slugify('Server 42')).toBe('server-42');
  });

  it('is deterministic — same input always produces same output', () => {
    expect(slugify('Test Server')).toBe(slugify('Test Server'));
  });
});

// ── resolveGuildSlug ──────────────────────────────────────────────────────────

describe('resolveGuildSlug', () => {
  it('returns the base slug when there are no collisions', () => {
    expect(resolveGuildSlug('Gaming Hub', [])).toBe('gaming-hub');
  });

  it('appends -2 on first collision', () => {
    expect(resolveGuildSlug('Gaming Hub', ['gaming-hub'])).toBe('gaming-hub-2');
  });

  it('appends -3 when -2 is also taken', () => {
    expect(resolveGuildSlug('Gaming Hub', ['gaming-hub', 'gaming-hub-2'])).toBe('gaming-hub-3');
  });

  it('skips to the first available suffix', () => {
    const existing = ['gaming-hub', 'gaming-hub-2', 'gaming-hub-3'];
    expect(resolveGuildSlug('Gaming Hub', existing)).toBe('gaming-hub-4');
  });

  it('handles an empty existingSlugs array', () => {
    expect(resolveGuildSlug('Test', [])).toBe('test');
  });

  it('handles collision on "unnamed"', () => {
    expect(resolveGuildSlug('', ['unnamed'])).toBe('unnamed-2');
  });
});
