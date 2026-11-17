import taxonomy from '../taxonomy.json';
import type { ColourFamily, Lab, Swatch, SwatchFamily } from '../types.js';
import { hexToRgb, rgbToLab } from './convert.js';

interface SwatchLab extends Swatch {
  readonly lab: Lab;
}

/** All swatches in seed order (LLD 4.3), each converted to CIELAB once. */
const SWATCHES: readonly SwatchLab[] = taxonomy.colourFamilies.flatMap((f) =>
  f.swatches.map((hex) => {
    const [r, g, b] = hexToRgb(hex);
    return { family: f.family as SwatchFamily, hex, lab: rgbToLab(r, g, b) };
  }),
);

/** The swatches in seed order, as plain family and hex pairs. */
export const swatches: readonly Swatch[] = SWATCHES.map(({ family, hex }) => ({ family, hex }));

/**
 * Colour family of an sRGB colour: nearest reference swatch by squared CIE76 distance.
 * Ties go to the swatch listed first in the seed. Returns null if any input is null or
 * undefined (as the SQL function does for null RGB). "Multi" is never returned here:
 * callers assign it from the is_multicolour flag.
 */
export function colourFamily(
  r: number | null | undefined,
  g: number | null | undefined,
  b: number | null | undefined,
): ColourFamily | null {
  if (r == null || g == null || b == null) return null;
  const [l, a, bb] = rgbToLab(r, g, b);
  let best: SwatchLab | undefined;
  let bestD = Infinity;
  for (const s of SWATCHES) {
    const d = (s.lab[0] - l) ** 2 + (s.lab[1] - a) ** 2 + (s.lab[2] - bb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best ? best.family : null;
}

/** The reference swatch of a family: the first swatch listed in the seed. Multi has none. */
export function referenceSwatch(family: ColourFamily): Swatch | undefined {
  return swatches.find((s) => s.family === family);
}
