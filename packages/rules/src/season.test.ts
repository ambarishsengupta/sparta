import { expect, it } from 'vitest';
import { seasonFor } from './season.js';

const NORTH = 'Winter Winter Spring Spring Spring Summer Summer Summer Autumn Autumn Autumn Winter'.split(' ');
const SOUTH = 'Summer Summer Autumn Autumn Autumn Winter Winter Winter Spring Spring Spring Summer'.split(' ');

it('maps every month to its season in both hemispheres (LLD 9.4)', () => {
  for (let m = 0; m < 12; m++) {
    const date = new Date(Date.UTC(2026, m, 15));
    expect([m, seasonFor(date, 'north')]).toEqual([m, NORTH[m]]);
    expect([m, seasonFor(date, 'south')]).toEqual([m, SOUTH[m]]);
  }
});
it('switches at the month boundary in UTC, whatever the machine time zone', () => {
  expect(seasonFor(new Date('2026-11-30T23:59:59Z'), 'north')).toBe('Autumn');
  expect(seasonFor(new Date('2026-12-01T00:00:00Z'), 'north')).toBe('Winter');
});
