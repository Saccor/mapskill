import { describe, expect, it } from 'vitest';
import { NODE_TYPE_TEXT, pickLang, STRINGS, t } from './i18n';

describe('i18n', () => {
  it('picks Swedish for sv browsers, English otherwise, and honours a saved choice', () => {
    expect(pickLang('sv-SE', null)).toBe('sv');
    expect(pickLang('en-US', null)).toBe('en');
    expect(pickLang(undefined, null)).toBe('en');
    expect(pickLang('sv-SE', 'en')).toBe('en');
    expect(pickLang('en-US', 'xx')).toBe('en');
  });

  it('has every key in both languages and fills in variables', () => {
    expect(Object.keys(STRINGS.sv).sort()).toEqual(Object.keys(STRINGS.en).sort());
    expect(t('sv', 'pendingRequests', { n: 2 })).toContain('2');
    expect(NODE_TYPE_TEXT.page.name.sv).toBe('Sida');
  });
});
