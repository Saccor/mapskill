import { describe, expect, it } from 'vitest';
import { ariaLabels } from './MapView';

const REACT_FLOW_KEYS = [
  'node.a11yDescription.default',
  'node.a11yDescription.keyboardDisabled',
  'node.a11yDescription.ariaLiveMessage',
  'edge.a11yDescription.default',
  'controls.ariaLabel',
  'controls.zoomIn.ariaLabel',
  'controls.zoomOut.ariaLabel',
  'controls.fitView.ariaLabel',
  'controls.interactive.ariaLabel',
  'minimap.ariaLabel',
  'handle.ariaLabel',
];

describe('ariaLabels', () => {
  it('covers every string React Flow has, in both languages, without talking about deleting', () => {
    for (const lang of ['en', 'sv'] as const) {
      const labels = ariaLabels(lang);
      expect(Object.keys(labels).sort()).toEqual([...REACT_FLOW_KEYS].sort());
      for (const [key, value] of Object.entries(labels)) {
        const text = typeof value === 'function' ? value({ direction: 'up', x: 1, y: 2 }) : value;
        expect(text, key).not.toMatch(/delete|remove|radera|ta bort/i);
        expect(text.length, key).toBeGreaterThan(0);
      }
    }
    expect(ariaLabels('sv')['controls.zoomIn.ariaLabel']).toBe('Zooma in');
  });
});
