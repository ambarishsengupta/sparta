// G4 gate: the three H&M-trained files must be marked "not built" (no sha256) in the manifest
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

const files = manifest && typeof manifest === 'object' ? manifest.files : undefined;
if (!files || typeof files !== 'object') {
  console.error(`manifest_check: ${target} has no "files" object`);
  process.exit(1);
}

let bad = 0;
for (const name of GUARDED) {
  const entry = files[name];
  if (entry === undefined) {
    console.log(`${name}: absent from manifest (treated as not built)`);
    continue;
  }
  const sha = entry && typeof entry === 'object' ? entry.sha256 : undefined;
  const pinned = typeof sha === 'string' ? sha.trim() !== '' : sha !== null && sha !== undefined;
  if (pinned) {
    console.error(`${name}: VIOLATION, sha256 is pinned (${JSON.stringify(sha)}); it must be null until G7 closes`);
    bad += 1;
  } else {
    console.log(`${name}: ok, not built (sha256 empty)`);
  }
}

if (bad > 0) {
  console.error(`manifest_check: FAIL (${bad} pinned) in ${target}`);
  process.exit(1);
}
console.log(`manifest_check: PASS (${target})`);
