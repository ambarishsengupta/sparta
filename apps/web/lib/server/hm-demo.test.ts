import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
afterEach(() => { delete process.env.HM_DEMO_IMAGE_ROOT; });

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
  it('exports GET and no other method', () => {
    expect(Object.keys(route).filter((k) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k))).toEqual(['GET']);
  });
});
