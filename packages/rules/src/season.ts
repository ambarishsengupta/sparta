import type { CurrentSeason, Hemisphere } from './types.js';

const NORTH: readonly CurrentSeason[] = [
  'Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer',
  'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter',
];

/**
 * Season for a date (LLD 9.4): north December to February is winter, March to May spring,
 * June to August summer, September to November autumn; south is shifted by six months.
 * Uses the UTC month so the same instant gives the same season on any machine (FR-58).
 */
export function seasonFor(date: Date, hemisphere: Hemisphere): CurrentSeason {
  const month = date.getUTCMonth() + (hemisphere === 'south' ? 6 : 0);
  return NORTH[month % 12] as CurrentSeason;
}
