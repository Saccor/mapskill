import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanProject } from '../graph/scan';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapskill-model-'));
const write = (rel: string, content: string) => {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};
write('package.json', '{"dependencies":{"next":"15.0.0"}}');
write('tsconfig.json', '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./*"]},"jsx":"preserve"}}');
write('lib/db.ts', 'export const supabase = { from: (t: string) => t };\nexport function helperA() { return 1; }\n');
write('components/Card.tsx', 'export function Card() { return <div />; }\n');
write('components/index.ts', "export { Card } from './Card';\n");
write(
  'app/page.tsx',
  "import { supabase } from '@/lib/db';\nimport { Card } from '@/components';\nexport default function Home() { supabase.from('x'); return <Card />; }\n",
);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('buildModel import targets', () => {
  const g = scanProject(dir);
  const page = 'page:app/page.tsx';

  it('does not attribute a non-function export to an unrelated function', () => {
    expect(g.edges.some((e) => e.from === page && e.to === 'helper:lib/db.ts#helperA')).toBe(false);
  });

  it('follows barrel re-exports to the real component', () => {
    expect(g.edges.some((e) => e.kind === 'uses' && e.from === page && e.to === 'component:components/Card.tsx#Card')).toBe(true);
    expect(g.edges.some((e) => e.from === page && e.to.startsWith('file:components/index.ts'))).toBe(false);
  });
});
