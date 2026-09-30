import { t } from '../i18n';
import type { ErrorEntry } from '../store/types';

/**
 * What an open editor says about a refused save. A conflict's own message names
 * version numbers, so the form repeats the banner's heading instead.
 */
export function editorErrorText(entry: ErrorEntry): string {
  return entry.kind === 'conflict' ? t('hv.banner.conflict.heading') : entry.message;
}
