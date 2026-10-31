import { describe, expect, it } from 'vitest';
import { explainText, fixText, pendingCount } from './requests';

describe('request texts', () => {
  it('explains a part in the chosen language', () => {
    const node = { id: 'n', type: 'helper' as const, zone: 'shared' as const, label: 'formatDate', file: 'lib/date.ts' };
    expect(explainText(node, 'sv')).toBe(
      'Förklara formatDate (lib/date.ts) för mig på enkel svenska: vad den gör, vem som använder den, och om något verkar fel.',
    );
    expect(explainText(node, 'en')).toContain('in plain English');
  });

  it('turns a finding into an instruction and counts pending requests', () => {
    const f = { id: 'f', kind: 'exact-duplicate' as const, certainty: 'certain' as const, nodeIds: [], files: [], message: { en: 'm', sv: 'm' }, instruction: 'Keep A, delete B.' };
    expect(fixText(f, 'en')).toBe('Keep A, delete B.');
    expect(fixText(f, 'sv')).toBe('Svara på svenska. Keep A, delete B.');
    const r = (status: 'pending' | 'sent' | 'cancelled') => ({ id: status, kind: 'custom' as const, text: 'x', createdAt: 0, status });
    expect(pendingCount([r('pending'), r('sent'), r('pending'), r('cancelled')])).toBe(2);
  });
});
