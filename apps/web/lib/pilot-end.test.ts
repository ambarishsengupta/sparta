import { describe, expect, it } from 'vitest';
import { BANNER_DAYS, bannerState, endDateText } from './pilot-end';

const END = '2026-12-15';

describe('bannerState: the 14-day boundary (FR-69)', () => {
  it('day 14 is shown', () => expect(bannerState(END, 'close', '2026-12-01')).toEqual({ show: true, endDate: END, outcome: 'close', daysLeft: 14 }));
  it('day 15 is hidden', () => expect(bannerState(END, 'close', '2026-11-30')).toEqual({ show: false }));
  it('the end date itself is shown', () => expect(bannerState(END, 'continue', END)).toEqual({ show: true, endDate: END, outcome: 'continue', daysLeft: 0 }));
  it('a past date is shown, with a negative count', () => expect(bannerState(END, 'close', '2027-02-01')).toMatchObject({ show: true, endDate: END, daysLeft: -48 }));
  it('the window is 14 days', () => expect(BANNER_DAYS).toBe(14));
  it('counts across a month and a leap day', () => {
    expect(bannerState('2028-03-01', 'close', '2028-02-16')).toMatchObject({ show: true, daysLeft: 14 });
    expect(bannerState('2028-03-01', 'close', '2028-02-15')).toEqual({ show: false });
  });
});

describe('bannerState: both outcomes and bad input', () => {
  it.each(['close', 'continue'] as const)('the %s outcome is carried through', (o) => expect(bannerState(END, o, '2026-12-10')).toMatchObject({ show: true, outcome: o }));
  it.each([[null, 'close'], [undefined, 'close'], ['', 'close'], ['2026-02-30', 'close'], ['15/12/2026', 'close'], [END, null], [END, ''], [END, 'delete']])('is hidden for date %j and outcome %j', (d, o) => {
    expect(bannerState(d, o, '2026-12-10')).toEqual({ show: false });
  });
  it('is hidden when today is not a date', () => expect(bannerState(END, 'close', 'today')).toEqual({ show: false }));
  it('writes the date in words', () => expect(endDateText(END)).toBe('15 December 2026'));
});
