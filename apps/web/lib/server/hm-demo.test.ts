import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// WO-0130 (4): the real fs/promises, with calls recorded so the tests can see that the file is opened once and every later call goes through that handle.
const calls = vi.hoisted(() => ({ open: [] as string[], byPath: [] as string[], closed: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      calls.open.push(String(args[0]));
      const handle = await actual.open(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => { calls.closed += 1; await close(); };
      return handle;
    },
    stat: async (...args: Parameters<typeof actual.stat>) => { calls.byPath.push('stat'); return actual.stat(...args); },
    readFile: async (...args: Parameters<typeof actual.readFile>) => { calls.byPath.push('readFile'); return actual.readFile(...args); },
  };
});
import * as route from '../../app/hm-image/[id]/route';
import { hmImageEnabled, hmImagePath } from './hm-demo';

// WO-0121: the local demo photograph route. Every file here is invented: a tiny JPEG-looking byte string in a temp folder, ids starting 099.
const ID = '0990000001';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
let root = '';
const ask = (id: string) => route.GET(new Request(`http://localhost/hm-image/${id}`), { params: Promise.resolve({ id }) });
const put = (id: string, bytes: Buffer) => { mkdirSync(join(root, 'images', id.slice(0, 3)), { recursive: true }); writeFileSync(join(root, 'images', id.slice(0, 3), `${id}.jpg`), bytes); };

beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'hm-demo-test-')); put(ID, JPEG); put('0990000002', Buffer.alloc(2 * 1024 * 1024 + 1)); put('0990000003', Buffer.alloc(2 * 1024 * 1024)); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
afterEach(() => { delete process.env.HM_DEMO_IMAGE_ROOT; calls.open.length = 0; calls.byPath.length = 0; calls.closed = 0; });

describe('lib/server/hm-demo.ts', () => {
  it('is off when the variable is unset or empty', () => {
    expect(hmImageEnabled()).toBe(false);
    expect(hmImagePath(ID)).toBeNull();
    process.env.HM_DEMO_IMAGE_ROOT = '';
    expect(hmImageEnabled()).toBe(false);
  });
  it('builds <root>/images/<first three digits>/<id>.jpg for a 10-digit id', () => {
    process.env.HM_DEMO_IMAGE_ROOT = root;
    expect(hmImageEnabled()).toBe(true);
    expect(hmImagePath(ID)).toBe(join(root, 'images', '099', `${ID}.jpg`));
  });
  it.each(['', '123', '09900000010', '099000000a', '../../etc/passwd', '..%2f..%2f0990000001', '099/000001', '0990000001.jpg', ' 0990000001', '0990000001\n', '٠٩٩٠٠٠٠٠٠١'])('refuses the id %j', (id) => {
    process.env.HM_DEMO_IMAGE_ROOT = root;
    expect(hmImagePath(id)).toBeNull();
  });
});

describe('GET /hm-image/[id]', () => {
  it('answers 404 for everything when the variable is unset, even for a file that exists', async () => {
    expect((await ask(ID)).status).toBe(404);
  });
  it('serves a valid id as image/jpeg with a private one-hour cache', async () => {
    process.env.HM_DEMO_IMAGE_ROOT = root;
    const res = await ask(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(Buffer.from(await res.arrayBuffer()).equals(JPEG)).toBe(true);
  });
  it.each(['abc', '123456789', '12345678901', '../../../etc/passwd', '..%2F..%2F..%2Fetc%2Fpasswd', '099000000/', '0990000001/../0990000001'])('answers 404 for the invalid id or traversal attempt %j', async (id) => {
    process.env.HM_DEMO_IMAGE_ROOT = root;
    expect((await ask(id)).status).toBe(404);
  });
  it('answers 404 for a valid id with no file', async () => {
    process.env.HM_DEMO_IMAGE_ROOT = root;
    expect((await ask('0990000009')).status).toBe(404);
  });
  it('answers 404 above 2 MB and serves a file of exactly 2 MB', async () => {
    process.env.HM_DEMO_IMAGE_ROOT = root;
    expect((await ask('0990000002')).status).toBe(404);
    expect((await ask('0990000003')).status).toBe(200);
  });
  it('opens the file once, checks the size and reads on that handle (no stat or read by path), and closes the handle', async () => {
    process.env.HM_DEMO_IMAGE_ROOT = root;
    expect((await ask(ID)).status).toBe(200);
    expect(calls.open).toEqual([join(root, 'images', '099', `${ID}.jpg`)]);
    expect(calls.byPath).toEqual([]);
    expect(calls.closed).toBe(1);
  });
  it('closes the handle on the 404 for a file over the limit, and opens nothing for an invalid id', async () => {
    process.env.HM_DEMO_IMAGE_ROOT = root;
    expect((await ask('0990000002')).status).toBe(404);
    expect(calls.open.length).toBe(1);
    expect(calls.closed).toBe(1);
    expect((await ask('abc')).status).toBe(404);
    expect(calls.open.length).toBe(1);
  });
  it('answers 404 for a folder (closing its handle) and for a missing file', async () => {
    process.env.HM_DEMO_IMAGE_ROOT = root;
    mkdirSync(join(root, 'images', '099', '0990000008.jpg'), { recursive: true });
    expect((await ask('0990000008')).status).toBe(404);
    expect((await ask('0990000009')).status).toBe(404);
    expect(calls.byPath).toEqual([]);
    expect(calls.closed).toBe(1);
  });
  it('answers 404 at once for a named pipe (it must not block waiting for a writer) and closes its handle', async () => {
    process.env.HM_DEMO_IMAGE_ROOT = root;
    mkdirSync(join(root, 'images', '099'), { recursive: true });
    execFileSync('mkfifo', [join(root, 'images', '099', '0990000007.jpg')]);   // no mkfifo on the machine: this throws and the test fails, it is not skipped
    const res = await Promise.race([ask('0990000007'), new Promise<never>((_, no) => setTimeout(() => no(new Error('the route blocked on a named pipe')), 2000))]);
    expect(res.status).toBe(404);
    expect(calls.open.length).toBe(1);
    expect(calls.closed).toBe(1);
    expect(calls.byPath).toEqual([]);
  }, 5000);
  it('exports GET and no other method', () => {
    expect(Object.keys(route).filter((k) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k))).toEqual(['GET']);
  });
});
