const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `2026-11-22` as `22 Nov 2026` (the text is cut apart, so no time zone can move the day). */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  const month = MONTHS[Number(m) - 1];
  return y && m && d && month ? `${Number(d)} ${month} ${y}` : isoDate;
}
