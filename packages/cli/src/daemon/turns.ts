import { randomUUID } from 'node:crypto';
import type { Certainty, Finding } from '@mapskill/core';

interface Turn {
  sessionId: string;
  /** Finding ids that existed when the turn started. */
  baseline: Set<string>;
  /** Files Claude reported touching during the turn. */
  touched: Set<string>;
}

export interface FindingQuery {
  touchedOnly?: boolean;
  certainty?: Certainty;
}

/** Turns kept per session, so one busy session cannot push out another session's turn. */
const MAX_TURNS_PER_SESSION = 20;
/** Safety cap over all sessions. */
const MAX_TURNS = 1000;

/** Remembers, per Claude session, which findings existed when a turn began and which files Claude touched since. */
export class TurnTracker {
  /** All turns, oldest first (Map keeps insertion order). */
  private readonly turns = new Map<string, Turn>();
  /** Turn ids per session, oldest first. */
  private readonly bySession = new Map<string, string[]>();
  private readonly current = new Map<string, string>();

  startTurn(sessionId: string, currentFindingIds: Iterable<string>): string {
    const id = randomUUID();
    this.turns.set(id, { sessionId, baseline: new Set(currentFindingIds), touched: new Set() });
    this.current.set(sessionId, id);
    const ids = this.bySession.get(sessionId) ?? [];
    ids.push(id);
    this.bySession.set(sessionId, ids);
    while (ids.length > MAX_TURNS_PER_SESSION) this.evict(ids[0]);
    while (this.turns.size > MAX_TURNS) this.evict(this.turns.keys().next().value as string);
    return id;
  }

  private evict(id: string): void {
    const turn = this.turns.get(id);
    if (!turn) return;
    this.turns.delete(id);
    const ids = this.bySession.get(turn.sessionId);
    if (ids) {
      const at = ids.indexOf(id);
      if (at >= 0) ids.splice(at, 1);
      if (ids.length === 0) this.bySession.delete(turn.sessionId);
    }
    if (this.current.get(turn.sessionId) === id) this.current.delete(turn.sessionId);
  }

  hasTurn(turnId: string): boolean {
    return this.turns.has(turnId);
  }

  currentTurn(sessionId: string): string | undefined {
    const id = this.current.get(sessionId);
    return id !== undefined && this.turns.has(id) ? id : undefined;
  }

  /** Records touched files in the session's current turn, starting one if needed. Returns the turn id. */
  touch(sessionId: string, files: string[], currentFindingIds: Iterable<string>): string {
    const id = this.currentTurn(sessionId) ?? this.startTurn(sessionId, currentFindingIds);
    const turn = this.turns.get(id)!;
    for (const file of files) turn.touched.add(file);
    return id;
  }

  newFindings(turnId: string, findings: Finding[], query: FindingQuery = {}): Finding[] {
    const turn = this.turns.get(turnId);
    if (!turn) return [];
    return findings.filter(
      (f) =>
        !turn.baseline.has(f.id) &&
        (!query.certainty || f.certainty === query.certainty) &&
        (!query.touchedOnly || f.files.some((file) => turn.touched.has(file))),
    );
  }
}
