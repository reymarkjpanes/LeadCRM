import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../cell-renderers';

describe('shared Manila date/time presentation', () => {
  it.each([
    ['2026-10-08T23:35:37.695Z', 'Oct 9, 2026 07:35 AM', 'Oct 9, 2026 07:35:37 AM'],
    ['2026-10-10T10:39:48Z', 'Oct 10, 2026 06:39 PM', 'Oct 10, 2026 06:39:48 PM'],
    ['2026-10-08T16:00:00Z', 'Oct 9, 2026 12:00 AM', 'Oct 9, 2026 12:00:00 AM'],
    ['2026-10-09T04:00:00Z', 'Oct 9, 2026 12:00 PM', 'Oct 9, 2026 12:00:00 PM'],
    ['2026-12-31T16:01:02Z', 'Jan 1, 2027 12:01 AM', 'Jan 1, 2027 12:01:02 AM'],
    ['2026-10-10T06:39:48-04:00', 'Oct 10, 2026 06:39 PM', 'Oct 10, 2026 06:39:48 PM'],
  ])('formats the instant %s in both conventions', (instant, minutes, seconds) => {
    expect(formatDateTime(instant)).toBe(minutes);
    expect(formatDateTime(instant, { seconds: true })).toBe(seconds);
    const date = new Date(instant), before = date.getTime();
    expect(formatDateTime(date, { seconds: true })).toBe(seconds);
    expect(date.getTime()).toBe(before);
  });
  it.each([null, undefined, '', 'invalid', new Date(NaN)])('keeps unavailable dates truthful: %s', value => {
    expect(formatDateTime(value)).toBe('—');
    expect(formatDateTime(value, { seconds: true })).toBe('—');
  });
});
