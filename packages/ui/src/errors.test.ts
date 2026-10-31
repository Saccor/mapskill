import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { errorText } from './errors';
import { t } from './i18n';

describe('errorText', () => {
  it('maps API statuses to localised text', () => {
    expect(errorText(new ApiError(400, 'x'), 'en')).toBe(t('en', 'errBadRequest'));
    expect(errorText(new ApiError(404, 'x'), 'sv')).toBe(t('sv', 'errGone'));
    expect(errorText(new ApiError(401, 'x'), 'en')).toBe(t('en', 'staleTab'));
    expect(errorText(new ApiError(403, 'x'), 'sv')).toBe(t('sv', 'staleTab'));
    expect(errorText(new ApiError(409, 'x'), 'sv')).toBe(t('sv', 'lockedByFolder'));
    expect(errorText(new ApiError(413, 'x'), 'en')).toBe(t('en', 'errTooLarge'));
    expect(errorText(new ApiError(500, 'x'), 'en')).toBe(t('en', 'errServer'));
    expect(errorText(new ApiError(503, 'x'), 'sv')).toBe(t('sv', 'errServer'));
  });

  it('treats anything else as the server not answering and never shows the raw message', () => {
    expect(errorText(new TypeError('Failed to fetch'), 'en')).toBe(t('en', 'errOffline'));
    expect(errorText('boom', 'sv')).toBe(t('sv', 'errOffline'));
    expect(errorText(new ApiError(400, 'secret detail'), 'en')).not.toContain('secret');
  });
});
