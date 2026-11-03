// G4 gate: the three H&M-trained files must be marked "not-built" (no hash) in the manifest
// until G7 (OI-5) is closed by the product owner and the SA. Exit 0 = ok, exit 1 = violation.
// Usage: node workflow/gates/manifest_check.mjs [path-to-manifest]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARDED = ['garment-cnn-v2.onnx', 'pairing-prior-v1.json', 'unlock-candidates.json'];
const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ? resolve(process.argv[2]) : resolve(here, '..', '..', 'models.manifest.json');

let manifest;
try {
  manifest = JSON.parse(readFileSync(target, 'utf8'));
} catch (err) {
  console.error(`manifest_check: cannot read or parse ${target}: ${err.message}`);
  process.exit(1);
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

if (!isPlainObject(manifest)) {
  console.error(`manifest_check: ${target} is not a JSON object`);
  process.exit(1);
}
const files = manifest.files;
if (!isPlainObject(files)) {
  console.error(`manifest_check: ${target} has no "files" plain object`);
  process.exit(1);
}

// Any key that looks like a hash, at any depth of an entry, must be null.
const hashLike = (key) => /sha|hash|digest/i.test(key);
function pinnedFields(value, path) {
  const found = [];
  if (!isPlainObject(value)) return found;
  for (const [k, v] of Object.entries(value)) {
    if (hashLike(k) && v !== null) found.push(`${path}.${k}=${JSON.stringify(v)}`);
    if (isPlainObject(v)) found.push(...pinnedFields(v, `${path}.${k}`));
  }
  return found;
}

let bad = 0;
const fail = (msg) => {
  console.error(msg);
  bad += 1;
};
for (const name of GUARDED) {
  if (!Object.prototype.hasOwnProperty.call(files, name)) {
    fail(`${name}: VIOLATION, missing from manifest; it must be listed with status "not-built"`);
    continue;
  }
  const entry = files[name];
  if (!isPlainObject(entry)) {
    fail(`${name}: VIOLATION, entry is not an object (${JSON.stringify(entry)})`);
    continue;
  }
  let entryBad = false;
  if (entry.status !== 'not-built') {
    fail(`${name}: VIOLATION, status is ${JSON.stringify(entry.status)}; it must be "not-built" until G7 closes`);
    entryBad = true;
  }
  for (const f of pinnedFields(entry, name)) {
    fail(`${name}: VIOLATION, hash-like field is pinned (${f}); it must be null until G7 closes`);
    entryBad = true;
  }
  if (!entryBad) console.log(`${name}: ok, not built (status "not-built", no hash pinned)`);
}

if (bad > 0) {
  console.error(`manifest_check: FAIL (${bad} violation(s)) in ${target}`);
  process.exit(1);
}
console.log(`manifest_check: PASS (${target})`);
