// G4 gate: the three H&M-trained files must be marked "not-built" (no hash) in the manifest
// until G7 (OI-5) is closed by the product owner and the SA. Exit 0 = ok, exit 1 = violation.
// Usage: node workflow/gates/manifest_check.mjs [path-to-manifest]
//
// Rules, all of which fail the check:
//  1. The text must be valid JSON with a top-level object that has a "files" plain object.
//  2. No duplicate key at any depth (JSON.parse would silently keep the last one and hide the first),
//     and no "__proto__" key at any depth.
//  3. Anywhere in the whole manifest (objects and arrays, any depth), a field whose key contains
//     sha, hash, digest, checksum, integrity, etag, md5 or crc (case-insensitive) must be null.
//     The single top-level "version" field is the only field exempt from this scan.
//  4. Each guarded file has an entry in "files" that is an object with status "not-built".
//  5. "files" has no extra entry that is an alias of a guarded file once normalised (trimmed, lowercased,
//     backslashes to slashes, leading "./" and any directory part stripped, trailing .bak/.old/.tmp stripped).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARDED = ['garment-cnn-v2.onnx', 'pairing-prior-v1.json', 'unlock-candidates.json'];
const HASH_KEY = /sha|hash|digest|checksum|integrity|etag|md5|crc/i;
const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ? resolve(process.argv[2]) : resolve(here, '..', '..', 'models.manifest.json');

let text;
let manifest;
try {
  text = readFileSync(target, 'utf8');
  manifest = JSON.parse(text);
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

let bad = 0;
const fail = (msg) => {
  console.error(msg);
  bad += 1;
};

// --- Rule 2: duplicate keys and __proto__, found by tokenising the raw text (the text is already valid JSON).
function scanKeys(src) {
  const dups = [];
  const protos = [];
  let i = 0;
  const ws = () => {
    while (i < src.length && ' \t\r\n'.includes(src[i])) i += 1;
  };
  const str = () => {
    const begin = i;
    i += 1; // opening quote
    while (src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
    i += 1; // closing quote
    return JSON.parse(src.slice(begin, i)); // decoded, so "a" and "a" are the same key
  };
  const value = (path) => {
    ws();
    const c = src[i];
    if (c === '{') {
      i += 1;
      const seen = new Set();
      ws();
      if (src[i] === '}') {
        i += 1;
        return;
      }
      for (;;) {
        ws();
        const key = str();
        const here = `${path}${path ? '.' : ''}${key}`;
        if (seen.has(key)) dups.push(here);
        seen.add(key);
        if (key === '__proto__') protos.push(here);
        ws();
        i += 1; // colon
        value(here);
        ws();
        if (src[i] === ',') {
          i += 1;
          continue;
        }
        i += 1; // closing brace
        return;
      }
    } else if (c === '[') {
      i += 1;
      ws();
      if (src[i] === ']') {
        i += 1;
        return;
      }
      let n = 0;
      for (;;) {
        value(`${path}[${n}]`);
        n += 1;
        ws();
        if (src[i] === ',') {
          i += 1;
          continue;
        }
        i += 1; // closing bracket
        return;
      }
    } else if (c === '"') {
      str();
    } else {
      while (i < src.length && !',]} \t\r\n'.includes(src[i])) i += 1; // number or literal
    }
  };
  value('');
  return { dups, protos };
}

try {
  const { dups, protos } = scanKeys(text);
  for (const d of dups) fail(`VIOLATION, duplicate key "${d}" (JSON.parse would silently keep only the last one)`);
  for (const p of protos) fail(`VIOLATION, forbidden key "__proto__" at "${p}"`);
} catch (err) {
  fail(`VIOLATION, the key scan could not tokenise the manifest: ${err.message}`);
}

// --- Rule 3: hash-like fields anywhere, through objects and arrays.
function pinnedFields(value, path, found = []) {
  if (Array.isArray(value)) {
    value.forEach((v, n) => pinnedFields(v, `${path}[${n}]`, found));
  } else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const here = `${path}.${k}`;
      if (HASH_KEY.test(k) && v !== null) found.push(`${here}=${JSON.stringify(v)}`);
      pinnedFields(v, here, found);
    }
  }
  return found;
}
const pinned = [];
for (const [k, v] of Object.entries(manifest)) {
  if (k === 'version') continue; // the one exempt top-level field
  if (HASH_KEY.test(k) && v !== null) pinned.push(`${k}=${JSON.stringify(v)}`);
  pinnedFields(v, k, pinned);
}
for (const f of pinned) fail(`VIOLATION, hash-like field is pinned (${f}); every hash-like field must be null until G7 closes`);

// --- Rule 5: aliases of a guarded name among the extra entries of "files".
const normalise = (name) => {
  let n = name.trim().toLowerCase().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  n = n.slice(n.lastIndexOf('/') + 1);
  let prev;
  do {
    prev = n;
    n = n.replace(/\.(bak|old|tmp)$/, '');
  } while (n !== prev);
  return n;
};
for (const key of Object.keys(files)) {
  if (GUARDED.includes(key)) continue;
  const norm = normalise(key);
  if (GUARDED.includes(norm)) fail(`VIOLATION, extra "files" entry ${JSON.stringify(key)} is an alias of ${norm}; remove it`);
}

// --- Rule 4: the guarded entries.
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
  if (entry.status !== 'not-built') {
    fail(`${name}: VIOLATION, status is ${JSON.stringify(entry.status)}; it must be "not-built" until G7 closes`);
  } else if (!pinned.some((f) => f.startsWith(`files.${name}.`)) && bad === 0) {
    console.log(`${name}: ok, not built (status "not-built", no hash pinned)`);
  }
}

if (bad > 0) {
  console.error(`manifest_check: FAIL (${bad} violation(s)) in ${target}`);
  process.exit(1);
}
console.log(`manifest_check: PASS (${target})`);
