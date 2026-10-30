import path from 'node:path';
import { parseArgs } from 'node:util';
import { scanProject, toPublicGraph, ZONE_LABELS, type Graph, type Zone } from '@mapskill/core';

export function runScan(argv: string[], write: (s: string) => void = (s) => process.stdout.write(s)): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      lang: { type: 'string', default: 'en' },
    },
  });
  const graph = scanProject(path.resolve(positionals[0] ?? '.'));
  if (values.json) {
    write(JSON.stringify(toPublicGraph(graph), null, 2) + '\n');
    return 0;
  }
  write(formatSummary(graph, values.lang === 'sv' ? 'sv' : 'en'));
  return 0;
}

export function formatSummary(g: Graph, lang: 'en' | 'sv'): string {
  const zones = Object.keys(ZONE_LABELS) as Zone[];
  const counts = zones.map((z) => `${ZONE_LABELS[z][lang]}: ${g.nodes.filter((n) => n.zone === z).length}`).join(' · ');
  const certain = g.findings.filter((f) => f.certainty === 'certain');
  const likely = g.findings.filter((f) => f.certainty === 'likely');
  const heading =
    lang === 'sv'
      ? `Fynd: ${certain.length} säkra, ${likely.length} troliga`
      : `Findings: ${certain.length} certain, ${likely.length} likely`;
  const lines = [
    `Mapskill · ${path.basename(g.root)} (${g.framework})`,
    counts,
    heading,
    ...[...certain, ...likely].map((f) => `  [${f.certainty}] ${f.message[lang]}`),
  ];
  return lines.join('\n') + '\n';
}
