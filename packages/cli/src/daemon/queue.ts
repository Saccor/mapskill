export type Actor = 'claude' | 'watcher';

export interface ChangeBatch {
  /** All changed project-relative paths, sorted. */
  paths: string[];
  /** The subset Claude reported through a hook, sorted. */
  byClaude: string[];
}

/** Collects changed paths and hands them over in one batch after a quiet period (debounce), at the latest `maxWaitMs` after the first one. */
export class ChangeQueue {
  private readonly pending = new Map<string, Actor>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firstAt = 0;

  constructor(
    private readonly onFlush: (batch: ChangeBatch) => void,
    private readonly delayMs = 200,
    private readonly maxWaitMs = 1000,
  ) {}

  get size(): number {
    return this.pending.size;
  }

  add(rel: string, by: Actor): void {
    if (this.pending.size === 0) this.firstAt = Date.now();
    if (this.pending.get(rel) !== 'claude') this.pending.set(rel, by);
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.delayMs, this.firstAt + this.maxWaitMs - Date.now()));
    this.timer = setTimeout(() => this.flushNow(), wait);
  }

  flushNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.size === 0) return;
    // Code-unit order, like the rest of the engine: independent of the machine's locale.
    const entries = [...this.pending].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    this.pending.clear();
    this.onFlush({
      paths: entries.map(([p]) => p),
      byClaude: entries.filter(([, by]) => by === 'claude').map(([p]) => p),
    });
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
  }
}
