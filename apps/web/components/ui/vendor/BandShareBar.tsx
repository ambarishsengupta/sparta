import { BarList } from './BarList';
import { Suppressed } from './Bar';

/** The share of each condition band of one category, in percent of 100. When no band has a share the whole category is one suppressed cell (FR-76). */
export function BandShareBar({ category, bands }: { category: string; bands: { band: string; share: number | null }[] }) {
  if (bands.every((b) => b.share === null)) return <p><Suppressed /></p>;
  return <BarList name={`Condition of ${category}: share of rated items per band`} max={100} rows={bands.map((b) => ({ label: b.band, value: b.share, text: b.share === null ? undefined : `${b.share}%` }))} />;
}
