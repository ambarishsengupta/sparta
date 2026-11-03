import type { Lab } from '../types.js';

// Same constants as catalog.rgb_to_lab / catalog.srgb_lin in LLD section 4.3.
const srgbLin = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const labF = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16.0 / 116);

/** sRGB (0-255 each) to CIELAB, D65, exactly as the LLD 4.3 SQL function does. */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const rl = srgbLin(r / 255.0);
  const gl = srgbLin(g / 255.0);
  const bl = srgbLin(b / 255.0);
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Parse "#RRGGBB" into [r, g, b]. Throws on anything else. */
export function hexToRgb(hex: string): readonly [number, number, number] {
  const m = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(hex);
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  return [parseInt(m[1] as string, 16), parseInt(m[2] as string, 16), parseInt(m[3] as string, 16)];
}

/** Format r, g, b (0-255) as "#RRGGBB" in upper case. */
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}
