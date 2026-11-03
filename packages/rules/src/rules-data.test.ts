import { OCCASIONS, SUB_TYPES } from '@sparta/taxonomy';
import { expect, it } from 'vitest';
import rules from '../data/rules.json';

const sum = (w: Record<string, number>): number => Object.values(w).reduce((a, b) => a + b, 0);

it('weights_base is rule_fit 0.50, occasion 0.20, completeness 0.10, condition 0.10, favourites 0.10, sums to 1, no pairing (CC4)', () => {
  expect(rules.weights_base).toEqual({ rule_fit: 0.5, occasion_fit: 0.2, completeness: 0.1, condition: 0.1, favourites: 0.1 });
  expect(sum(rules.weights_base)).toBeCloseTo(1, 12);
});
it('weights_with_pairing is 0.40, 0.15, 0.15, 0.10, 0.10, 0.10 and sums to 1 (stored for R4, unused now)', () => {
  expect(rules.weights_with_pairing).toEqual({ rule_fit: 0.4, pairing: 0.15, occasion_fit: 0.15, completeness: 0.1, condition: 0.1, favourites: 0.1 });
  expect(sum(rules.weights_with_pairing)).toBeCloseTo(1, 12);
});
it('holds the chroma thresholds 10 and 50, unlock_min_rule_fit 0.6, unrated condition 0.7 and the eight neutrals', () => {
  expect([rules.thresholds.neutral_chroma_below, rules.thresholds.bold_chroma_above]).toEqual([10, 50]);
  expect([rules.unlock_min_rule_fit, rules.unrated_condition]).toEqual([0.6, 0.7]);
  expect([...rules.neutral_colour_families].sort()).toEqual(['Beige', 'Black', 'Brown', 'Grey', 'Khaki', 'Navy', 'Olive', 'White']);
});
it('has an entry for every occasion, Date and Travel use Casual, and only real sub-types are named', () => {
  expect(Object.keys(rules.occasions).sort()).toEqual([...OCCASIONS].sort());
  expect([rules.occasions.Date, rules.occasions.Travel]).toEqual([{ uses: 'Casual' }, { uses: 'Casual' }]);
  const named = Object.values(rules.occasions).flatMap((o) => ('slots' in o ? [...Object.values(o.slots).flat(), ...o.forbidden_pairs.flat()] : []));
  expect(named.filter((n) => !(SUB_TYPES as string[]).includes(n))).toEqual([]);
});
