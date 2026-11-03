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
    // hash-like fields inside arrays
    ['a pinned hash inside an array', 'manifest_bad_hash_in_array.json', 'artifacts[0].sha256'],
    ['a pinned hash inside nested arrays', 'manifest_bad_hash_in_nested_array.json', 'history[0][0].md5'],
    // the whole manifest is scanned, not just the three guarded entries
    ['a pinned hash at the top level', 'manifest_bad_hash_top_level.json', 'checksum'],
    ['a pinned hash in an extra files entry', 'manifest_bad_hash_extra_file.json', 'extra-model.bin'],
    ['a pinned hash in another top-level section', 'manifest_bad_hash_other_section.json', 'meta.build.integrity'],
    // duplicate keys at any depth (JSON.parse would hide them)
    ['a duplicate hash key that ends in null', 'manifest_bad_duplicate_hash_key.json', 'duplicate key'],
    ['a duplicated guarded entry whose last copy is clean', 'manifest_bad_duplicate_entry.json', 'duplicate key "files.garment-cnn-v2.onnx"'],
    ['a duplicate key spelled with a unicode escape', 'manifest_bad_duplicate_escaped_key.json', 'duplicate key'],
    ['a duplicate top-level version key', 'manifest_bad_duplicate_top_level.json', 'duplicate key "version"'],
    // hash-like key patterns, case-insensitive
    ['a hash key (contentHash)', 'manifest_bad_key_hash.json', 'contentHash'],
    ['a checksum key', 'manifest_bad_key_checksum.json', 'checksum'],
    ['an integrity key', 'manifest_bad_key_integrity.json', 'integrity'],
    ['an etag key (ETag)', 'manifest_bad_key_etag.json', 'ETag'],
    ['an md5 key (md5sum)', 'manifest_bad_key_md5.json', 'md5sum'],
    ['a crc key (crc32)', 'manifest_bad_key_crc.json', 'crc32'],
    ['an upper-case key (SHA1)', 'manifest_bad_key_uppercase.json', 'SHA1'],
    // extra entries that alias a guarded file name
    ['an extra .bak entry for a guarded file', 'manifest_bad_alias_bak.json', 'garment-cnn-v2.onnx.bak'],
    ['an extra ./ entry for a guarded file', 'manifest_bad_alias_dotslash.json', './pairing-prior-v1.json'],
    ['an extra upper-case .OLD entry for a guarded file', 'manifest_bad_alias_case_old.json', 'Unlock-Candidates.json.OLD'],
    ['an extra entry with stacked .bak.tmp suffixes', 'manifest_bad_alias_tmp_stack.json', 'garment-cnn-v2.onnx.bak.tmp'],
    // __proto__
    ['a top-level __proto__ key', 'manifest_bad_proto_top_level.json', '__proto__'],
    ['a __proto__ key inside a guarded entry', 'manifest_bad_proto_in_entry.json', '__proto__'],
  ];
  for (const [label, fixture, mention] of bad) {
    it(`exits 1 on ${label} (${fixture})`, () => {
      const r = run(`workflow/gates/fixtures/${fixture}`);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(mention);
    });
  }

  it('allows the single top-level version field and other harmless extra files', () => {
    const r = run('workflow/gates/fixtures/manifest_ok_extra_file.json');
    expect(r.status, r.stderr).toBe(0);
  });
});
