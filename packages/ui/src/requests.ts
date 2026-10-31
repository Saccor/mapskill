import type { Finding, MapNode, MapRequest } from '@mapskill/core/client';
import { t, type Lang } from './i18n';

export function explainText(node: MapNode, lang: Lang): string {
  return t(lang, 'askText', { name: node.label, file: node.file ?? node.label });
}

/** The finding's ready-made instruction (English, for Claude), asking for a Swedish answer when the user reads Swedish. */
export function fixText(finding: Finding, lang: Lang): string {
  return lang === 'sv' ? `Svara på svenska. ${finding.instruction}` : finding.instruction;
}

export function pendingCount(requests: MapRequest[]): number {
  return requests.filter((r) => r.status === 'pending').length;
}
