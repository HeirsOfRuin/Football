// A football season runs 1 July -> 30 June. Days are indexed 0-364 from 1 July,
// which keeps every schedule calculation integer arithmetic.

export const MONTHS = ['July', 'August', 'September', 'October', 'November', 'December',
  'January', 'February', 'March', 'April', 'May', 'June'];
export const MONTH_LENGTHS = [31, 31, 30, 31, 30, 31, 31, 28, 31, 30, 31, 30];
export const WEEKDAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const SEASON_DAYS = MONTH_LENGTHS.reduce((a, b) => a + b, 0);

export function dayToDate(day) {
  let d = ((day % SEASON_DAYS) + SEASON_DAYS) % SEASON_DAYS;
  for (let i = 0; i < MONTHS.length; i++) {
    if (d < MONTH_LENGTHS[i]) {
      return { monthIndex: i, month: MONTHS[i], dayOfMonth: d + 1, weekday: WEEKDAYS[day % 7] };
    }
    d -= MONTH_LENGTHS[i];
  }
  return { monthIndex: 11, month: 'June', dayOfMonth: 30, weekday: WEEKDAYS[day % 7] };
}

export function formatDay(day, seasonStartYear) {
  const d = dayToDate(day);
  const year = d.monthIndex >= 6 ? seasonStartYear + 1 : seasonStartYear;
  return `${d.weekday} ${d.dayOfMonth} ${d.month} ${year}`;
}

export function shortDate(day, seasonStartYear) {
  const d = dayToDate(day);
  const year = d.monthIndex >= 6 ? seasonStartYear + 1 : seasonStartYear;
  return `${d.dayOfMonth} ${d.month.slice(0, 3)} ${String(year).slice(2)}`;
}

export function isWeekend(day) {
  const wd = day % 7;
  return wd === 0 || wd === 1;
}

/** Calendar year a season day falls in. */
export function yearOf(day, seasonStartYear) {
  return dayToDate(day).monthIndex >= 6 ? seasonStartYear + 1 : seasonStartYear;
}

export const KEY_DAYS = {
  preSeasonStart: 0,
  summerWindowEnd: 61,      // 31 August
  seasonStart: 40,          // ~10 August
  winterWindowStart: 184,   // 1 January
  winterWindowEnd: 214,     // 31 January
  seasonEnd: 330,           // ~26 May
  boardReview: 336,
  seasonRollover: 360,
};

export function transferWindowOpen(day) {
  return day <= KEY_DAYS.summerWindowEnd
    || (day >= KEY_DAYS.winterWindowStart && day <= KEY_DAYS.winterWindowEnd);
}
