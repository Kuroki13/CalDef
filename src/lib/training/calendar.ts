/**
 * Days, weeks and months for the training calendar.
 *
 * Pure date arithmetic on ISO dates ("2026-11-16"). A session's day is
 * decided once, in the user's time zone, before it gets here — nothing in
 * this file touches a clock or a zone.
 */

import { addDays, startOfIsoWeek, type IsoDate } from "@/lib/dates";

export type DayMark = {
  date: IsoDate;
  /** Day of the month, for the cell. */
  day: number;
  /** False for the days of neighbouring months that pad the grid. */
  inMonth: boolean;
  isToday: boolean;
  /** Sessions completed that day. */
  done: { id: number; name: string }[];
  /** Workouts planned that day and not yet done. */
  planned: { id: number; templateId: number; name: string }[];
};

type Marks = {
  done: readonly { id: number; name: string; date: IsoDate }[];
  planned: readonly { id: number; templateId: number; name: string; date: IsoDate }[];
};

function mark(date: IsoDate, today: IsoDate, month: string | null, marks: Marks): DayMark {
  return {
    date,
    day: Number(date.slice(8, 10)),
    inMonth: month === null || date.startsWith(month),
    isToday: date === today,
    done: marks.done.filter((s) => s.date === date).map(({ id, name }) => ({ id, name })),
    planned: marks.planned
      .filter((p) => p.date === date)
      .map(({ id, templateId, name }) => ({ id, templateId, name })),
  };
}

/** The seven days, Monday first, of the week `date` falls in. */
export function weekOf(date: IsoDate, today: IsoDate, marks: Marks): DayMark[] {
  const monday = startOfIsoWeek(date);
  return Array.from({ length: 7 }, (_, i) => mark(addDays(monday, i), today, null, marks));
}

/** "2026-11" → whole weeks, Monday first, covering that month. */
export function monthGrid(month: string, today: IsoDate, marks: Marks): DayMark[][] {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const weeks: DayMark[][] = [];
  for (let monday = startOfIsoWeek(first); monday <= last; monday = addDays(monday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => mark(addDays(monday, i), today, month, marks)));
  }
  return weeks;
}

/** "2026-11" shifted by whole months. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December",
];

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export const isMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export type WeekCount = {
  /** The Monday the week starts on. */
  weekStart: IsoDate;
  sessions: number;
};

/**
 * Sessions per week for the last `weeks` weeks, oldest first, ending with
 * the week `today` is in. A week with none is a zero, not a gap — "I did
 * not train" is information.
 */
export function weeklyFrequency(
  sessionDates: readonly IsoDate[],
  today: IsoDate,
  weeks = 8,
): WeekCount[] {
  const thisWeek = startOfIsoWeek(today);
  return Array.from({ length: weeks }, (_, i) => {
    const weekStart = addDays(thisWeek, -7 * (weeks - 1 - i));
    const end = addDays(weekStart, 6);
    return {
      weekStart,
      sessions: sessionDates.filter((d) => d >= weekStart && d <= end).length,
    };
  });
}
