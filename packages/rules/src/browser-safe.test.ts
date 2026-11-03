/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

// Source of every non-test file under packages/rules/src (tests may use node; shipped code may not).
const sources = import.meta.glob<string>(['./**/*.ts', '!./**/*.test.ts'], {
  query: '?raw', import: 'default', eager: true,
});

const BUILTINS = 'fs|fs/promises|path|os|http|https|http2|net|tls|dns|dgram|child_process|worker_threads|crypto|stream|url|zlib';
const IMPORTS = new RegExp(`(?:from|import|require\\()\\s*\\(?\\s*['"](?:node:[^'"]*|(?:${BUILTINS}))['"]`);
const GLOBALS = /\b(?:window|document|fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator|globalThis\.(?:fetch|window|document))\b/;

/** Lines that import node:*, fs or other Node built-ins, or use browser or network globals. */
function offences(text: string): string[] {
  return text.split('\n').filter((l) => IMPORTS.test(l) || GLOBALS.test(l.replace(/\/\/.*$/, '')));
}

describe('packages/rules/src is browser-safe (FR-59, CC6)', () => {
  it('finds the shipped source files', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(5);
  });
  it.each(['import fs from "node:fs"', "import { x } from 'fs'", "const f = require('path')", 'await fetch(url)', 'window.localStorage', 'document.cookie', 'new WebSocket(u)'])(
    'the scanner flags: %s', (line) => {
      expect(offences(line)).toHaveLength(1);
    },
  );
  it('no source file imports node:*, fs or a Node built-in, or touches window, document or the network', () => {
    const found = Object.entries(sources).flatMap(([file, text]) => offences(text).map((l) => `${file}: ${l.trim()}`));
    expect(found).toEqual([]);
  });
});
