import { ApiError } from './api';
import { t, type Lang } from './i18n';

/** Text for a failed call, in the user's language. The raw message never reaches the screen (log it with console.warn). */
export function errorText(err: unknown, lang: Lang): string {
  if (!(err instanceof ApiError)) return t(lang, 'errOffline');
  if (err.status === 404) return t(lang, 'errGone');
  if (err.status === 409) return t(lang, 'lockedByFolder');
  if (err.status === 413) return t(lang, 'errTooLarge');
  if (err.status >= 500) return t(lang, 'errServer');
  return t(lang, 'errBadRequest');
}
