export const MANILA_TIME_ZONE = "Asia/Manila";
const TASK_TIME_ZONE = MANILA_TIME_ZONE;

type ZonedDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsInTimeZone(date: Date, timeZone: string): ZonedDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function formatWallDateTime(parts: ZonedDateTimeParts): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Render an instant as the wall-clock value used by the task datetime picker. */
export function manilaLocalDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatWallDateTime(partsInTimeZone(date, TASK_TIME_ZONE));
}

export function manilaCurrentDateTime(now = new Date()): string {
  return manilaLocalDateTime(now);
}

export function manilaCurrentDate(now = new Date()): string {
  return manilaCurrentDateTime(now).slice(0, 10);
}

function timeZoneOffsetAt(instantMs: number, timeZone: string): number {
  const instant = new Date(instantMs);
  const parts = partsInTimeZone(instant, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Convert Manila wall-clock input to the ISO instant format used by the API. */
export function manilaTaskDueInstant(value: string): string {
  const normalized = value.length === 10 ? `${value}T17:00` : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(normalized);
  if (!match) throw new Error("Choose a valid due date and time.");
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = wallClockAsUtc - timeZoneOffsetAt(wallClockAsUtc, TASK_TIME_ZONE);
  const instantMs = wallClockAsUtc - timeZoneOffsetAt(firstGuess, TASK_TIME_ZONE);
  const instant = new Date(instantMs);
  if (
    Number.isNaN(instant.getTime()) ||
    manilaLocalDateTime(instant) !== normalized
  ) {
    throw new Error("Choose a valid due date and time.");
  }
  return instant.toISOString();
}

function nextCalendarDay(value: string): string {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}T${time}`;
}

/** If today's Manila clock time has passed, schedule the next occurrence tomorrow. */
export function resolveManilaTaskDueDateTime(value: string, now = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  if (value.slice(0, 10) !== manilaCurrentDate(now)) return value;
  return Date.parse(manilaTaskDueInstant(value)) <= now.getTime()
    ? nextCalendarDay(value)
    : value;
}

export function isPastManilaTaskDueDateTime(value: string, now = new Date()): boolean {
  return Date.parse(manilaTaskDueInstant(value)) <= now.getTime();
}
