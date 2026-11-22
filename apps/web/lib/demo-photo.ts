import { rgbToHex } from '@sparta/taxonomy';
import type { Category } from '@sparta/taxonomy';
import { HM_ARTICLES } from './demo-hm';
import type { HmArticle } from './demo-hm';
import { emptyForm } from './item-form';
import type { ItemFormValues } from './item-form';

/** Add by photo in the no-login demo (UI only): the six sample photos, the form values a photo "suggests", and the browser-side shrink of an uploaded file. No network call. */
const MID_GREY = '#808080';
const LONG_SIDE = 480;
const QUALITY = 0.8;

/**
 * Six sample photos from the H&M demo articles: one top, one bottom, one pair of shoes, one jacket, one accessory, and one more (another top or bottom of a different sub-type).
 * The choice is fixed (articles sorted by sku, first one with a colour per category), so the row looks the same on every visit. Fewer than six when the list has no article for a category.
 */
export function pickSamples(articles: readonly HmArticle[] = HM_ARTICLES): HmArticle[] {
  const sorted = [...articles].sort((a, b) => (a.sku < b.sku ? -1 : 1));
  const firstOf = (category: Category, skip: (a: HmArticle) => boolean = () => false): HmArticle | undefined =>
    sorted.find((a) => a.category === category && !skip(a) && a.rgb !== null) ?? sorted.find((a) => a.category === category && !skip(a));
  const chosen = (['Tops', 'Bottoms', 'Footwear', 'Outerwear', 'Accessories'] as const).flatMap((c) => firstOf(c) ?? []);
  const used = new Set(chosen.map((a) => a.sku));
  const kinds = new Set(chosen.map((a) => a.subType));
  const more = firstOf('Tops', (a) => used.has(a.sku) || kinds.has(a.subType)) ?? firstOf('Bottoms', (a) => used.has(a.sku) || kinds.has(a.subType)) ?? sorted.find((a) => !used.has(a.sku));
  return more ? [...chosen, more] : chosen;
}

/** What the "photo" suggests for a sample: its own category, sub-type, name and colour. */
export function valuesForSample(a: HmArticle): ItemFormValues {
  return { ...emptyForm(), category: a.category, subType: a.subType, name: a.name, nameEdited: true, hex: rgbToHex(...(a.rgb ?? [128, 128, 128])) };
}

/** What the "photo" suggests for an uploaded file: Tops, T-shirt, no name, mid-grey. */
export function valuesForUpload(): ItemFormValues {
  return { ...emptyForm(), category: 'Tops', subType: 'T-shirt', hex: MID_GREY };
}

/** The size an image of `width` x `height` is shrunk to: the long side at most `max`, the shape kept, never enlarged. */
export function fitWithin(width: number, height: number, max: number = LONG_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Shrinks a chosen photo in the browser (canvas): at most 480 px on the long side, JPEG at quality 0.8, returned as a data URL. Rejects when the file cannot be read as an image. */
export async function shrinkPhoto(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('This file could not be read as a picture. Try another photo.'));
      el.src = url;
    });
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot shrink the photo.');
    ctx.fillStyle = '#ffffff'; // a transparent PNG becomes white, not black, in a JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}
