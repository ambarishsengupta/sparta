import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import taxonomy from '../taxonomy.json';
import { COLOUR_FAMILIES } from '../validators.js';
import { hexToRgb, rgbToHex, rgbToLab } from './convert.js';
import { colourFamily, referenceSwatch, swatches } from './family.js';

const fam = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  return colourFamily(r, g, b);
};

describe('golden colour vectors (LLD section 11)', () => {
  it('golden vector #00008B gives Navy', () => {
    expect(fam('#00008B')).toBe('Navy');
  });
  it('golden vector #1560BD gives Blue', () => {
    expect(fam('#1560BD')).toBe('Blue');
  });
  it('golden vector #C0C0C0 gives Grey', () => {
    expect(fam('#C0C0C0')).toBe('Grey');
  });
  it('golden vector #36454F gives Grey', () => {
    expect(fam('#36454F')).toBe('Grey');
  });
  it('golden vector #800020 gives Maroon', () => {
    expect(fam('#800020')).toBe('Maroon');
  });
  it('golden vector null RGB gives null', () => {
    expect(colourFamily(null, null, null)).toBeNull();
    expect(colourFamily(undefined, 10, 10)).toBeNull();
    expect(colourFamily(10, null, 10)).toBeNull();
    expect(colourFamily(10, 10, undefined)).toBeNull();
  });
});

describe('colour family list (FDD section 13)', () => {
  it('has exactly the 18 values of FDD 13, in order', () => {
    expect(COLOUR_FAMILIES).toEqual([
      'Black', 'White', 'Grey', 'Navy', 'Blue', 'Teal', 'Green', 'Olive', 'Khaki',
      'Beige', 'Brown', 'Maroon', 'Red', 'Orange', 'Yellow', 'Pink', 'Purple', 'Multi',
    ]);
    expect(new Set(COLOUR_FAMILIES).size).toBe(18);
  });
  it('Multi has no swatch and every other family has at least one', () => {
    for (const f of taxonomy.colourFamilies) {
      expect(f.swatches.length === 0).toBe(f.family === 'Multi');
    }
  });
  it('lists 32 swatches in the LLD 4.3 seed order', () => {
    expect(swatches).toHaveLength(32);
    expect(swatches[0]).toEqual({ family: 'Black', hex: '#000000' });
    expect(swatches[2]).toEqual({ family: 'Grey', hex: '#808080' });
    expect(swatches[31]).toEqual({ family: 'Purple', hex: '#6A3D9A' });
  });
});

describe('nearest swatch', () => {
  it('maps every swatch to its own family', () => {
    for (const s of swatches) {
      expect(fam(s.hex), `${s.hex} should be ${s.family}`).toBe(s.family);
    }
  });
  it('maps the browser-name colours the earlier draft got wrong (LLD 4.3)', () => {
    expect(fam('#000080')).toBe('Navy');
    expect(fam('#0000FF')).toBe('Blue');
    expect(fam('#F0E68C')).toBe('Khaki');
    expect(fam('#D3D3D3')).toBe('Grey');
    expect(fam('#ADD8E6')).toBe('Blue');
  });
  it('referenceSwatch is the first swatch listed for each family', () => {
    for (const f of taxonomy.colourFamilies) {
      expect(referenceSwatch(f.family as never)?.hex).toBe(f.swatches[0]);
    }
    expect(referenceSwatch('Grey')?.hex).toBe('#808080');
    expect(referenceSwatch('Multi')).toBeUndefined();
  });
  it('never returns Multi', () => {
    for (const [r, g, b] of [[0, 0, 0], [255, 255, 255], [200, 30, 90], [12, 200, 77]] as const) {
      expect(colourFamily(r, g, b)).not.toBe('Multi');
    }
  });
});

describe('rgbToLab', () => {
  it('black is L=0 with a=b=0', () => {
    expect(rgbToLab(0, 0, 0)).toEqual([0, 0, 0]);
  });
  it('white is L about 100 with a and b about 0', () => {
    const [l, a, b] = rgbToLab(255, 255, 255);
    expect(l).toBeCloseTo(100, 4);
    expect(a).toBeCloseTo(0, 4);
    expect(b).toBeCloseTo(0, 4);
  });
  // Hand computation from the LLD 4.3 formula. For 128: c = 128/255 = 0.50196; linear =
  // ((0.50196 + 0.055) / 1.055)^2.4 = 0.21586; y = 0.21586 (the matrix row sums to 1.0000001);
  // L = 116 * cbrt(0.21586) - 16 = 116 * 0.60000 - 16 = 53.585; a and b are 0 because x, z are
  // the D65 white point scaled by the same factor.
  it('mid grey (128,128,128) is L=53.585, a=b=0', () => {
    const [l, a, b] = rgbToLab(128, 128, 128);
    expect(l).toBeCloseTo(53.585, 2);
    expect(a).toBeCloseTo(0, 3);
    expect(b).toBeCloseTo(0, 3);
  });
  // Pure red: linear (1,0,0); x = 0.4124564/0.95047 = 0.43395, y = 0.2126729, z = 0.0193339/1.08883 = 0.017757.
  // fx = cbrt(0.43395) = 0.75700, fy = cbrt(0.2126729) = 0.59684, fz = 7.787*0.017757 + 16/116 = 0.27623 (z > 0.008856 so cbrt: 0.26089).
  // L = 116*0.59684 - 16 = 53.241; a = 500*(0.75700-0.59684) = 80.09; b = 200*(0.59684-0.26089) = 67.19.
  it('pure red (255,0,0) is about L=53.24, a=80.09, b=67.20', () => {
    const [l, a, b] = rgbToLab(255, 0, 0);
    expect(l).toBeCloseTo(53.24, 1);
    expect(a).toBeCloseTo(80.09, 1);
    expect(b).toBeCloseTo(67.2, 1);
  });
  // Pure blue: linear (0,0,1); x = 0.1804375/0.95047 = 0.18984, y = 0.072175, z = 0.9503041/1.08883 = 0.87278.
  // fx = 0.57497, fy = 0.41640, fz = 0.95580; L = 116*0.41640 - 16 = 32.30; a = 500*(0.57497-0.41640) = 79.3;
  // b = 200*(0.41640-0.95580) = -107.9.
  it('pure blue (0,0,255) is about L=32.30, a=79.2, b=-107.9', () => {
    const [l, a, b] = rgbToLab(0, 0, 255);
    expect(l).toBeCloseTo(32.3, 1);
    expect(a).toBeCloseTo(79.2, 0);
    expect(b).toBeCloseTo(-107.9, 0);
  });
  it('uses the low-light linear branch for very dark values (c <= 0.04045)', () => {
    // r=10: c = 0.039216 <= 0.04045, linear = c/12.92 = 0.0030353; y = 0.0030353 * 0.2126729 = 0.00064555
    // (below 0.008856) so fy = 7.787*y + 16/116 and L = 116*fy - 16 = 903.3*y = 0.5831.
    const [l] = rgbToLab(10, 0, 0);
    expect(l).toBeCloseTo(0.5831, 3);
  });
  it('L is between 0 and 100 for a spread of inputs', () => {
    for (const v of [0, 1, 17, 64, 128, 200, 254, 255]) {
      const [l] = rgbToLab(v, v, v);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(100.0001);
    }
  });
});

describe('hex helpers', () => {
  it('round-trips hex and rgb', () => {
    expect(hexToRgb('#1560BD')).toEqual([21, 96, 189]);
    expect(rgbToHex(21, 96, 189)).toBe('#1560BD');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
  });
  it('rejects malformed hex', () => {
    expect(() => hexToRgb('1560BD')).toThrow();
    expect(() => hexToRgb('#12345')).toThrow();
  });
});

describe('properties', () => {
  const channel = fc.integer({ min: 0, max: 255 });
  it('colourFamily returns one of the 18 families for any r,g,b in 0..255', () => {
    fc.assert(
      fc.property(channel, channel, channel, (r, g, b) => {
        const f = colourFamily(r, g, b);
        expect(f).not.toBeNull();
        expect(COLOUR_FAMILIES).toContain(f);
      }),
      { numRuns: 500 },
    );
  });
  it('colourFamily is deterministic', () => {
    fc.assert(
      fc.property(channel, channel, channel, (r, g, b) => {
        expect(colourFamily(r, g, b)).toBe(colourFamily(r, g, b));
      }),
      { numRuns: 500 },
    );
  });
  it('a colour exactly on a swatch always gets that swatch family', () => {
    fc.assert(
      fc.property(fc.constantFrom(...swatches), (s) => {
        expect(fam(s.hex)).toBe(s.family);
      }),
    );
  });
});
