// packages/cli/src/usage.ts
// A local usage log for the week-two return measure. Nothing here is ever sent anywhere.
// Hooks load this file, so it may only use node: built-ins (never @mapskill/core).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type UsageEvent = 'session' | 'map-open' | 'request-ask' | 'request-fix' | 'request-build' | 'reminder';

export interface UsageLine {
  /** Local date, YYYY-MM-DD. */
  d: string;
  e: UsageEvent;
  /** First 8 hex characters of sha256 of the project root. */
  p: string;
}

export interface UsageSummary {
  firstDay: string;
  /** Days since the first event, plus one. */
  days: number;
  sessionDays: number;
  mapDays: number;
  requests: { ask: number; fix: number; build: number };
  reminders: number;
  projects: number;
  weeks: { week: number; sessionDays: number; mapDays: number }[];
  /** Whether the map was opened in week 2; null until day 8 has come. */
  weekTwoMap: boolean | null;
}

const EVENTS: ReadonlySet<string> = new Set<UsageEvent>(['session', 'map-open', 'request-ask', 'request-fix', 'request-build', 'reminder']);
/** Events written at most once per (day, project). */
const ONCE_PER_DAY: ReadonlySet<UsageEvent> = new Set<UsageEvent>(['session', 'map-open']);
const MAX_BYTES = 512 * 1024;
const KEEP_LINES = 2000;
const DEDUPE_LINES = 200;

/** The usage log. MAPSKILL_HOME comes from `env` when one is given (and only from it), else from process.env. */
export function usageFile(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.MAPSKILL_HOME || path.join(os.homedir(), '.mapskill');
  return path.join(home, 'usage.jsonl');
}

function localDate(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function projectHash(projectRoot: string): string {
  const abs = path.resolve(projectRoot);
  return createHash('sha256').update(process.platform === 'win32' ? abs.toLowerCase() : abs).digest('hex').slice(0, 8);
}

/** Appends one event to the usage log. Synchronous, quick, and never throws. */
export function recordUsage(event: UsageEvent, projectRoot: string, options: { env?: NodeJS.ProcessEnv; now?: Date } = {}): void {
  try {
    const file = usageFile(options.env);
    const line = JSON.stringify({ d: localDate(options.now ?? new Date()), e: event, p: projectHash(projectRoot) } satisfies UsageLine);
    let existing = '';
    try {
      existing = fs.readFileSync(file, 'utf8');
    } catch {
      // no file yet
    }
    if (ONCE_PER_DAY.has(event) && existing.split('\n').filter(Boolean).slice(-DEDUPE_LINES).includes(line)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (Buffer.byteLength(existing) > MAX_BYTES) {
      const kept = existing.split('\n').filter(Boolean).slice(-(KEEP_LINES - 1)).join('\n');
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${kept}\n${line}\n`);
      fs.renameSync(tmp, file);
      return;
    }
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    // measuring must never get in the way
  }
}

/** Every valid line of the usage log, oldest first. Broken lines are skipped; a missing file gives []. */
export function readUsage(env: NodeJS.ProcessEnv = process.env): UsageLine[] {
  let text: string;
  try {
    text = fs.readFileSync(usageFile(env), 'utf8');
  } catch {
    return [];
  }
  const lines: UsageLine[] = [];
  for (const raw of text.split('\n')) {
    try {
      const v = JSON.parse(raw) as Partial<UsageLine> | null;
      if (v && typeof v.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.d) && typeof v.e === 'string' && EVENTS.has(v.e) && typeof v.p === 'string') {
        lines.push({ d: v.d, e: v.e as UsageEvent, p: v.p });
      }
    } catch {
      // skip a broken line
    }
  }
  return lines;
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Counts the log. Day 1 is the first event's day (today for an empty log); week 1 is days 1-7. */
export function summarize(lines: UsageLine[], now: Date): UsageSummary {
  const today = localDate(now);
  const dates = lines.map((l) => l.d).sort();
  const firstDay = dates[0] ?? today;
  const first = dayNumber(firstDay);
  const nowDay = dayNumber(today);
  const lastDay = Math.max(nowDay, dayNumber(dates[dates.length - 1] ?? today));
  const weekOf = (d: string): number => Math.floor((dayNumber(d) - first) / 7) + 1;
  const daysWith = (pred: (l: UsageLine) => boolean): string[] => [...new Set(lines.filter(pred).map((l) => l.d))];
  const sessionDays = daysWith((l) => l.e === 'session');
  const mapDays = daysWith((l) => l.e === 'map-open');
  const count = (e: UsageEvent): number => lines.filter((l) => l.e === e).length;
  const weeks = Array.from({ length: Math.floor((lastDay - first) / 7) + 1 }, (_, i) => ({
    week: i + 1,
    sessionDays: sessionDays.filter((d) => weekOf(d) === i + 1).length,
    mapDays: mapDays.filter((d) => weekOf(d) === i + 1).length,
  }));
  return {
    firstDay,
    days: Math.max(1, nowDay - first + 1), // a clock set back must not give day 0 or less
    sessionDays: sessionDays.length,
    mapDays: mapDays.length,
    requests: { ask: count('request-ask'), fix: count('request-fix'), build: count('request-build') },
    reminders: count('reminder'),
    projects: new Set(lines.map((l) => l.p)).size,
    weeks,
    weekTwoMap: nowDay - first >= 7 ? mapDays.some((d) => weekOf(d) === 2) : null,
  };
}
