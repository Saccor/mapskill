import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMAND_NAMES } from '../command-names';

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.resolve(here, '../../../../plugin/commands');
const files = fs.existsSync(commandsDir) ? fs.readdirSync(commandsDir).filter((f) => f.endsWith('.md')) : [];

function parse(text: string): { front: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error('missing frontmatter');
  const front: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) front[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { front, body: m[2] };
}

describe('plugin slash commands', () => {
  it('ships exactly map, lock, unlock and stats', () => {
    expect(files.sort()).toEqual(['lock.md', 'map.md', 'stats.md', 'unlock.md']);
  });

  for (const file of files) {
    describe(file, () => {
      const { front, body } = parse(fs.readFileSync(path.join(commandsDir, file), 'utf8'));

      it('has the required frontmatter', () => {
        expect(front.description).toBeTruthy();
        expect(front['disable-model-invocation']).toBe('true');
        expect(front['allowed-tools']).toContain('Bash(node *)');
      });

      it('runs the bundled entry with a command the CLI knows', () => {
        const m = /node "\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/mapskill\.mjs" (\S+)/.exec(body);
        expect(m, 'no mapskill command line').not.toBeNull();
        expect(COMMAND_NAMES).toContain(m![1]);
      });
    });
  }

  it('lock and unlock take a path argument', () => {
    for (const f of ['lock.md', 'unlock.md']) {
      const { front, body } = parse(fs.readFileSync(path.join(commandsDir, f), 'utf8'));
      expect(front['argument-hint']).toBeTruthy();
      expect(body).toContain('$ARGUMENTS');
    }
  });
});
