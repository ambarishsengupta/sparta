import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const run = (...args: string[]) =>
  spawnSync('node', ['workflow/gates/manifest_check.mjs', ...args], { encoding: 'utf8' });

describe('manifest_check', () => {
  it('exits 0 on the committed models.manifest.json', () => {
    expect(run().status).toBe(0);
  });

  it('exits 1 on a fixture that pins a hash for garment-cnn-v2.onnx', () => {
    const r = run('workflow/gates/fixtures/manifest_bad.json');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('garment-cnn-v2.onnx');
  });

  it('exits 1 when the manifest cannot be read or parsed', () => {
    expect(run('package.json.does-not-exist').status).toBe(1);
  });
});
