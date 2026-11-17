import { BLACK, WHITE, contrast, normaliseHex } from './colour';

export interface Paint { fill: string; outline: string; detail: string; }

/** The tile ground: the --paper token of globals.css, white in both themes. */
export const TILE_PAPER = '#ffffff';
/** Used when a stored colour is missing or not a hex code. */
export const FALLBACK_TINT = '#d4d4d4';
export const MIN_CONTRAST = 3;

/** Black or white, whichever is further from `base` in luminance. */
const stark = (base: string): string => (contrast(BLACK, base) >= contrast(WHITE, base) ? BLACK : WHITE);

/** Outline: black or white, limited to those that keep 3:1 against the tile (the better of the two always reaches 4.58), then the one that stands out more from the tint. */
export function pickOutline(tint: string, tile: string = TILE_PAPER): string {
  const ok = [BLACK, WHITE].filter((c) => contrast(c, tile) >= MIN_CONTRAST);
  return ok.length === 1 ? ok[0]! : stark(tint);
}

/** Detail line inside the garment: black or white by the tint's luminance. */
export const pickDetail = (tint: string): string => stark(tint);

export function paintFor(hex: unknown, tile: unknown = TILE_PAPER): Paint {
  const fill = normaliseHex(hex) ?? FALLBACK_TINT;
  return { fill, outline: pickOutline(fill, normaliseHex(tile) ?? TILE_PAPER), detail: pickDetail(fill) };
}
