/**
 * Naming the save shortcut. The binding accepts either modifier, so only the
 * printed hint varies: ⌘ only where a Command key is positively identified,
 * because Ctrl on a Mac still works and ⌘ on a PC names a missing key.
 */

import { t } from '../i18n';

/** The slice of `navigator` this needs, so tests can pass a plain object. */
export interface KeyboardPlatform {
  /** Chromium's replacement for the frozen `navigator.platform`. */
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
}

/** macOS, and the iPhone/iPad values older Safaris report. */
const APPLE = /^(mac|iphone|ipad|ipod)/i;

/** True only when the platform is known to be Apple's (iPadOS reports `MacIntel`). */
export function hasCommandKey(nav: KeyboardPlatform = navigator): boolean {
  const reported = nav.userAgentData?.platform ?? nav.platform;
  if (reported) return APPLE.test(reported);
  return /\b(Macintosh|Mac OS X|iPhone|iPad|iPod)\b/.test(nav.userAgent ?? '');
}

/**
 * A `keydown` listener that closes a surface on Escape and stops the key there,
 * so one Escape dismisses one thing.
 */
export function onEscape(close: () => void): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
}

/** How to write "save" as a chord: `⌘↵` on a Mac, `Ctrl+Enter` everywhere else. */
export function saveShortcutLabel(nav: KeyboardPlatform = navigator): string {
  return hasCommandKey(nav) ? '⌘↵' : t('hv.shortcut.ctrlEnter');
}
