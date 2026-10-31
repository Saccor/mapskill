const ID = /^[a-z0-9-]+$/;

/** The goal id in .mapskill/goal.yaml ('goal: <id>'), or null when the file says nothing usable. */
export function parseGoalFile(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*goal\s*:\s*(\S+)\s*$/.exec(line);
    if (m) return ID.test(m[1]) ? m[1] : null;
  }
  return null;
}

export function formatGoalFile(id: string): string {
  return `goal: ${id}\n`;
}
