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

  // Every fixture is a distinct way to pin (or hide) a model file; each must fail the check.
  const bad: Array<[string, string, string]> = [
    ['a non-object entry', 'manifest_bad_nonobject_entry.json', 'pairing-prior-v1.json'],
    ['a non-null digest-like field', 'manifest_bad_hash_field.json', 'unlock-candidates.json'],
    ['a non-null sha512 field', 'manifest_bad_hash_key_sha512.json', 'pairing-prior-v1.json'],
    ['a status other than not-built', 'manifest_bad_status.json', 'garment-cnn-v2.onnx'],
    ['a files value that is not a plain object', 'manifest_bad_files_not_object.json', 'files'],
    ['a missing entry for a guarded file', 'manifest_bad_missing_entry.json', 'unlock-candidates.json'],
  ];
  for (const [label, fixture, mention] of bad) {
    it(`exits 1 on ${label} (${fixture})`, () => {
      const r = run(`workflow/gates/fixtures/${fixture}`);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(mention);
    });
  }
});
