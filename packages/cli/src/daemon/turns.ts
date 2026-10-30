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

const MAX_TURNS = 100;

/** Remembers, per Claude session, which findings existed when a turn began and which files Claude touched since. */
export class TurnTracker {
  private readonly turns = new Map<string, Turn>();
  private readonly current = new Map<string, string>();

  startTurn(sessionId: string, currentFindingIds: Iterable<string>): string {
    const id = randomUUID();
    this.turns.set(id, { sessionId, baseline: new Set(currentFindingIds), touched: new Set() });
    this.current.set(sessionId, id);
    while (this.turns.size > MAX_TURNS) {
      const oldest = this.turns.keys().next().value as string;
      this.turns.delete(oldest);
    }
    return id;
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
