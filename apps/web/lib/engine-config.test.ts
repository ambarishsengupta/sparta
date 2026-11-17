/// <reference types="vite/client" />
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePrior } from '@sparta/rules';
import prior from '../../../packages/rules/data/fixtures/pairing-prior.fixture.json';
import {
  PRIOR_URL, UNLOCK_URL, SWITCHES, currentEngineConfig, engineOpts, getLearned, loadHmList, loadLearned, loadPrior, parseSwitches, setLearned,
} from './engine-config';
import type { Switches } from './engine-config';

const OFF: Switches = { pairingPrior: false, unlockList: 'fallback', embeddingSwap: false };
const PAIR: Switches = { ...OFF, pairingPrior: true };
const HM: Switches = { ...OFF, unlockList: 'hm' };
const LIST = [{ sub_type: 'Chinos', colour_family: 'Navy' }, { sub_type: 'Joggers', colour_family: 'Grey' }];
const reply = (body: unknown, ok = true) => ({ ok, json: async () => { if (body instanceof Error) throw body; return body; } }) as unknown as Response;
const stub = (impl: () => Promise<Response> | Response) => { const f = vi.fn(impl); vi.stubGlobal('fetch', f); return f; };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); setLearned({ prior: null, hm: null }); });

describe('switches and defaults (FR-59c)', () => {
  it('defaults: pairing prior off, unlock list fallback, embedding swap off', () => {
    expect(parseSwitches({})).toEqual(OFF);
    expect(SWITCHES).toEqual(OFF); // this test process sets none of the variables
  });
  it.each([['true', true], ['1', true], ['false', false], ['yes', false], ['TRUE', false], ['', false], [undefined, false]])('pairing and embedding switches: %s -> %s', (v, want) => {
    expect(parseSwitches({ NEXT_PUBLIC_PAIRING_PRIOR_ENABLED: v }).pairingPrior).toBe(want);
    expect(parseSwitches({ NEXT_PUBLIC_EMBEDDING_SWAP_ENABLED: v }).embeddingSwap).toBe(want);
  });
  it.each([['hm', 'hm'], ['fallback', 'fallback'], ['HM', 'fallback'], ['other', 'fallback'], [undefined, 'fallback']])('unlock list: %s -> %s', (v, want) => {
    expect(parseSwitches({ NEXT_PUBLIC_UNLOCK_LIST: v }).unlockList).toBe(want);
  });
  it('reads the three real variable names from the environment', async () => {
    vi.stubEnv('NEXT_PUBLIC_PAIRING_PRIOR_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_UNLOCK_LIST', 'hm');
    vi.stubEnv('NEXT_PUBLIC_EMBEDDING_SWAP_ENABLED', '1');
    vi.resetModules();
    expect((await import('./engine-config')).SWITCHES).toEqual({ pairingPrior: true, unlockList: 'hm', embeddingSwap: true });
  });
});

describe('engine_config and engine options (FDD 16)', () => {
  it('all off: the documented string and no prior', () => {
    expect(engineOpts(OFF).config).toBe('gm1;emb0;pair0;ul:fb;w:base');
    expect(currentEngineConfig()).toBe('gm1;emb0;pair0;ul:fb;w:base');
    expect(engineOpts(OFF, { prior: parsePrior(prior), hm: null }).suggest).toEqual({ prior: null }); // a switch that is off wins over loaded data
  });
  it('the unlock options get the prior only when its switch is on (Model QC Q23), and the H&M list only for the hm setting', () => {
    const loaded = { prior: parsePrior(prior), hm: LIST as never };
    expect(engineOpts(OFF, loaded).unlock).toEqual({ unlockList: 'fallback', hm: loaded.hm, prior: null });
    expect(engineOpts(PAIR, loaded).unlock).toEqual({ unlockList: 'fallback', hm: loaded.hm, prior: parsePrior(prior) });
    expect(engineOpts({ ...PAIR, unlockList: 'hm' }, loaded).unlock).toEqual({ unlockList: 'hm', hm: loaded.hm, prior: parsePrior(prior) });
  });
  it('prior on and valid: pair1 and w:pairing, and the prior reaches the engine options', () => {
    const o = engineOpts(PAIR, { prior: parsePrior(prior), hm: null });
    expect(o.config).toBe('gm1;emb0;pair1;ul:fb;w:pairing');
    expect(o.suggest.prior).toEqual(parsePrior(prior));
  });
  it('prior switched on but not loaded (missing or invalid file): pair0, because the prior really is off', () => {
    expect(engineOpts(PAIR, { prior: null, hm: null }).config).toBe('gm1;emb0;pair0;ul:fb;w:base');
  });
  it('H&M list: ul:hm only when asked for and loaded', () => {
    const hm = LIST as never;
    expect(engineOpts(HM, { prior: null, hm }).config).toBe('gm1;emb0;pair0;ul:hm;w:base');
    expect(engineOpts(HM, { prior: null, hm: null }).config).toContain('ul:fb');
    expect(engineOpts(OFF, { prior: null, hm }).config).toContain('ul:fb');
  });
  it('embedding swap only changes the string (no look embeddings exist yet)', () => {
    const [off, on] = [engineOpts(OFF), engineOpts({ ...OFF, embeddingSwap: true })];
    expect(on.config).toBe('gm1;emb1;pair0;ul:fb;w:base');
    expect([on.suggest, on.unlock]).toEqual([off.suggest, off.unlock]);
  });
  it('events carry the real configuration for the current switches', async () => {
    vi.stubEnv('NEXT_PUBLIC_PAIRING_PRIOR_ENABLED', 'true');
    vi.resetModules();
    const [cfg, ev] = [await import('./engine-config'), await import('./events')];
    const log = new ev.EventLog(null, () => 'T');
    expect(log.record('item_added').engine_config).toBe('gm1;emb0;pair0;ul:fb;w:base'); // switched on, nothing loaded yet
    cfg.setLearned({ prior: parsePrior(prior), hm: null });
    expect(log.record('item_added').engine_config).toBe('gm1;emb0;pair1;ul:fb;w:pairing');
  });
});

describe('run-time loaders (FR-59c, G4)', () => {
  it('make no request when their switch is off', async () => {
    const f = stub(async () => reply(prior));
    expect(await loadPrior(OFF)).toBeNull();
    expect(await loadHmList(OFF)).toBeNull();
    expect((await loadLearned(OFF))).toEqual({ prior: null, hm: null });
    expect(f).not.toHaveBeenCalled();
  });
  it('prior: a valid file is parsed with the engine parser; the request is a plain GET of the fixed URL with a time limit', async () => {
    const f = stub(async () => reply(prior));
    expect(await loadPrior(PAIR)).toEqual(parsePrior(prior));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect([f.mock.calls.length, url, init.method, init.credentials, Object.keys(init).sort()]).toEqual([1, '/pairing-prior-v1.json', 'GET', 'omit', ['credentials', 'method', 'signal']]);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    ['missing file (404)', () => reply({}, false)],
    ['an HTTP error that still has a valid body', () => reply(prior, false)],
    ['network error', () => Promise.reject(new Error('offline'))],
    ['not JSON', () => reply(new SyntaxError('bad json'))],
    ['wrong version', () => reply({ ...prior, version: 2 })],
    ['a number outside 0..1', () => reply({ ...prior, type_pairs: { 'Top+Bottom': { Shirt: { Jeans: 1.5 } } } })],
    ['an unknown key', () => reply({ ...prior, extra: 1 })],
  ])('prior: %s means the prior is off and nothing throws', async (_name, impl) => {
    stub(impl);
    expect(await loadPrior(PAIR)).toBeNull();
    expect(engineOpts(PAIR, { prior: await loadPrior(PAIR), hm: null }).config).toContain('pair0');
  });
  it('H&M list: fetched only for unlock list hm, validated, ignored when missing or invalid', async () => {
    const f = stub(async () => reply(LIST));
    expect(await loadPrior(HM)).toBeNull();
    expect(await loadHmList(HM)).toEqual(LIST);
    expect((f.mock.calls as unknown as string[][]).map((c) => c[0])).toEqual(['/unlock-candidates.json']);
    stub(async () => reply(Array.from({ length: 41 }, () => LIST[0])));
    expect(await loadHmList(HM)).toBeNull();
    stub(async () => reply({}, false));
    expect(await loadHmList(HM)).toBeNull();
  });
  it('loadLearned loads both when both are on, remembers them, and resolves with nulls when the files fail', async () => {
    stub(async () => reply(prior));
    expect((await loadLearned({ ...PAIR, unlockList: 'hm' })).prior).toEqual(parsePrior(prior));
    expect(getLearned().prior).not.toBeNull();
    stub(async () => Promise.reject(new Error('x')));
    expect(await loadLearned({ ...PAIR, unlockList: 'hm' })).toEqual({ prior: null, hm: null });
  });
});

describe('the only network calls, and the H&M files stay out of git (G4)', () => {
  const sources = import.meta.glob<string>(['./*.ts', '!./*.test.ts', '../components/**/*.ts', '../components/**/*.tsx', '!../components/**/*.test.ts'], { query: '?raw', import: 'default', eager: true });
  it('engine-config.ts holds exactly two fetch calls, both on its two constants, with no body or headers', () => {
    const text = readFileSync(new URL('./engine-config.ts', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(text.match(/\bfetch\(/g)).toHaveLength(2);
    expect(text).toContain('fetch(PRIOR_URL, init())');
    expect(text).toContain('fetch(UNLOCK_URL, init())');
    expect(text).not.toMatch(/\b(body|headers)\b/);
    expect([PRIOR_URL, UNLOCK_URL]).toEqual(['/pairing-prior-v1.json', '/unlock-candidates.json']);
  });
  it('no other source file names the two files or calls fetch', () => {
    const LEAVE = 'components/account/account-actions.ts';   // WO-0071: its one same-origin POST, `fetch(p, i)` (exact text, once), is checked below and by the strict scan
    const ADMIN = 'components/admin/admin-actions.ts';       // WO-0088: the admin page's one sender, the same exact text, once
    for (const [file, text] of Object.entries(sources)) if (!file.endsWith('engine-config.ts')) expect(file.endsWith(LEAVE) || file.endsWith(ADMIN) ? text.replace('(p, i) => fetch(p, i)', '') : text, file).not.toMatch(/pairing-prior|unlock-candidates|\bfetch\(/);
    for (const one of [LEAVE, ADMIN]) {
      const text = Object.entries(sources).find(([f]) => f.endsWith(one))?.[1];
      if (text) expect(text.match(/\bfetch\(/g)).toEqual(['fetch(']);
    }
  });
  const root = new URL('../../../', import.meta.url).pathname;
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  it('apps/web/.gitignore lists both public files and git agrees', () => {
    const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split('\n');
    for (const f of ['pairing-prior-v1.json', 'unlock-candidates.json']) {
      expect(ignore).toContain(`public/${f}`);
      expect(git('check-ignore', '-q', `apps/web/public/${f}`).status).toBe(0);
    }
  });
  it('no pairing-prior or unlock-candidates file is tracked anywhere', () => {
    expect(git('ls-files').stdout.split('\n').filter((f) => /pairing-prior-v|unlock-candidates/.test(f))).toEqual([]);
  });
});
