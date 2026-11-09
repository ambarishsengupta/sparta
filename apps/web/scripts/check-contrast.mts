// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// Token contrast gate (plan 4.4, method A; plan 5.3 "fails the build if any pair
// drops below its threshold"). Reads the light and dark token blocks straight from
// app/globals.css, computes WCAG 2.x contrast for every pair and exits 1 on any
// failure. Run: `npm run check:contrast` (Node 22.18+ runs this file directly).
// An optional first argument checks another stylesheet (used to test the gate).
//
// The browser check (axe in Playwright) is the one that counts for rendered
// pixels; this script catches a bad token edit before anything renders.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS_PATH = process.argv[2] ?? fileURLToPath(new URL("../app/globals.css", import.meta.url));

type Tokens = Record<string, string>;
type Pair = { fg: string; bg: string; min: number; note?: string };

const TEXT = 4.5; // WCAG 1.4.3, normal text
const NON_TEXT = 3; // WCAG 1.4.11, UI components and focus indicators

const FLASHES = ["tangerine", "pink", "lime", "cyan", "yellow", "cobalt"] as const;

// Every pair in plan 4.4, plus the surface pairs the tab bar and cards rely on.
const NEUTRAL_PAIRS: Pair[] = [
  { fg: "ink", bg: "canvas", min: TEXT },
  { fg: "ink-soft", bg: "canvas", min: TEXT },
  { fg: "ink-mute", bg: "canvas", min: TEXT },
  { fg: "ink", bg: "surface", min: TEXT },
  { fg: "ink-soft", bg: "surface", min: TEXT },
  { fg: "ink-mute", bg: "surface", min: TEXT },
  { fg: "control-border", bg: "canvas", min: NON_TEXT },
  { fg: "control-border", bg: "surface", min: NON_TEXT },
  { fg: "focus", bg: "canvas", min: NON_TEXT },
  { fg: "focus", bg: "surface", min: NON_TEXT },
  { fg: "accent-text", bg: "canvas", min: TEXT },
  { fg: "accent-text", bg: "surface", min: TEXT },
];

const FLASH_PAIRS: Pair[] = FLASHES.flatMap((f) => [
  { fg: `on-${f}`, bg: f, min: TEXT, note: "text on fill" },
  { fg: "ink", bg: `${f}-tint`, min: TEXT, note: "ink on tint" },
  // Plan rule: all text on tinted tiles is ink or ink-soft, never ink-mute.
  { fg: "ink-soft", bg: `${f}-tint`, min: TEXT, note: "ink-soft on tint" },
  // Textile motifs sit under header text. Checked at full strength (worst case),
  // so a motif can never push the title or intro below 4.5:1.
  { fg: "ink", bg: `${f}-motif`, min: TEXT, note: "ink over motif" },
  { fg: "ink-soft", bg: `${f}-motif`, min: TEXT, note: "ink-soft over motif" },
]);

function blockText(css: string, name: string): string {
  const start = css.indexOf(`/* tokens:${name}:start */`);
  const end = css.indexOf(`/* tokens:${name}:end */`);
  if (start < 0 || end < 0) throw new Error(`token markers for "${name}" not found in globals.css`);
  return css.slice(start, end);
}

function extractBlock(css: string, name: string): Tokens {
  return parseDecls(blockText(css, name));
}

/** Raw declarations: values may be #rrggbb, oklch(L% C H) or a single var(--name). */
function parseDecls(block: string): Tokens {
  const tokens: Tokens = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+?)\s*;/g)) {
    tokens[m[1]] = m[2].trim().toLowerCase();
  }
  return tokens;
}

/** OKLCH to sRGB hex (CSS Color 4 matrices), clipped to the sRGB gamut. */
function oklchToHex(value: string): string {
  const m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!m) throw new Error(`cannot parse colour "${value}"`);
  const L = Number(m[1]) / 100;
  const C = Number(m[2]);
  const H = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  return (
    "#" +
    lin
      .map((c) => {
        const v = Math.min(1, Math.max(0, c));
        const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
        return Math.round(srgb * 255)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}

/** Resolve every token to #rrggbb, following var() into the theme block, then the scales. */
function resolveAll(tokens: Tokens, scales: Tokens): Tokens {
  const resolve = (value: string, depth = 0): string => {
    if (depth > 8) throw new Error(`var() cycle at "${value}"`);
    if (/^#[0-9a-f]{6}$/.test(value)) return value;
    if (value.startsWith("oklch(")) return oklchToHex(value);
    const ref = /^var\(--([a-z0-9-]+)\)$/.exec(value);
    if (ref) {
      const next = tokens[ref[1]] ?? scales[ref[1]];
      if (next === undefined) throw new Error(`undefined token --${ref[1]}`);
      return resolve(next, depth + 1);
    }
    return value; // not a colour (e.g. transparent); never used in a pair
  };
  return Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, resolve(v)]));
}

function extractSelectorBlock(css: string, selector: string): Tokens {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`selector ${selector} not found in globals.css`);
  return parseDecls(css.slice(i, css.indexOf("}", i)));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function check(theme: string, tokens: Tokens, pairs: Pair[]) {
  const rows: string[] = [];
  let failures = 0;
  for (const p of pairs) {
    const fg = tokens[p.fg];
    const bg = tokens[p.bg];
    if (!fg || !bg) {
      rows.push(`  MISSING  ${p.fg} on ${p.bg}: token not defined`);
      failures++;
      continue;
    }
    const ratio = contrast(fg, bg);
    const ok = ratio >= p.min;
    if (!ok) failures++;
    rows.push(
      `  ${ok ? "pass" : "FAIL"}  ${ratio.toFixed(2).padStart(5)} >= ${p.min.toFixed(1)}  ${p.fg} on ${p.bg}${p.note ? `  (${p.note})` : ""}`,
    );
  }
  return { rows, failures };
}

/** Flash fills under 3:1 on the canvas must carry the ink edge (plan 4.3). */
function checkFillBoundaries(theme: string, tokens: Tokens, edgeIsInk: boolean) {
  const rows: string[] = [];
  let failures = 0;
  for (const f of FLASHES) {
    const ratio = contrast(tokens[f], tokens.canvas);
    if (ratio >= NON_TEXT) {
      rows.push(`  pass  ${ratio.toFixed(2).padStart(5)} >= 3.0  ${f} fill vs canvas`);
    } else if (edgeIsInk) {
      const edge = contrast(tokens.ink, tokens.canvas);
      const ok = edge >= NON_TEXT;
      if (!ok) failures++;
      rows.push(
        `  ${ok ? "pass" : "FAIL"}  ${ratio.toFixed(2).padStart(5)} <  3.0  ${f} fill vs canvas, ink edge ${edge.toFixed(2)} marks the boundary`,
      );
    } else {
      failures++;
      rows.push(
        `  FAIL  ${ratio.toFixed(2).padStart(5)} <  3.0  ${f} fill vs canvas, and ${theme} has no ink edge`,
      );
    }
  }
  return { rows, failures };
}

function main() {
  const css = readFileSync(CSS_PATH, "utf8");
  const scales = extractBlock(css, "scales");
  const darkRaw = extractBlock(css, "dark");
  const light = resolveAll(extractBlock(css, "light"), scales);
  const dark = resolveAll(darkRaw, scales);
  const darkOverride = extractSelectorBlock(css, ':root[data-theme="dark"]');

  let failures = 0;

  // The explicit data-theme="dark" block must repeat the media-query values exactly.
  const drift = Object.keys({ ...darkRaw, ...darkOverride }).filter(
    (k) => darkRaw[k] !== darkOverride[k],
  );
  if (drift.length) {
    failures += drift.length;
    console.log(`FAIL  data-theme="dark" differs from the dark media block: ${drift.join(", ")}`);
  }

  // The ink edge is on in light mode (--flash-edge: var(--ink)) and off in dark.
  // Read from the light block only, so an edge defined elsewhere does not count.
  const lightEdgeIsInk = /--flash-edge:\s*var\(--ink\)/.test(blockText(css, "light"));

  for (const [theme, tokens, edge] of [
    ["light", light, lightEdgeIsInk],
    ["dark", dark, false],
  ] as const) {
    console.log(`\n${theme} theme`);
    for (const result of [
      check(theme, tokens, NEUTRAL_PAIRS),
      check(theme, tokens, FLASH_PAIRS),
      checkFillBoundaries(theme, tokens, edge),
    ]) {
      console.log(result.rows.join("\n"));
      failures += result.failures;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} contrast check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll token contrast checks passed.");
}

main();
