/**
 * Naming the save shortcut in the language of the keyboard actually in front of
 * the user.
 *
 * The binding itself has always accepted either modifier — the editor tests
 * `e.metaKey || e.ctrlKey` — so Ctrl+Enter has worked on a PC since day one. Only
 * the footer hint was wrong: it printed the Apple glyphs unconditionally, so a
 * Windows dashboard advertised a ⌘ key it does not have.
 *
 * A dashboard is opened from whatever is to hand, and a card cannot see the
 * hardware — only what the browser reports about the OS it runs on. So the rule
 * is: print ⌘ only where a Command key is positively identified, and fall back to
 * the PC labelling everywhere else, including when the platform is unreadable.
 * Being told Ctrl on a Mac still works (Ctrl+Enter saves there too); being told ⌘
 * on a PC names a key that is not on the keyboard.
 */

/** The slice of `navigator` this needs, so tests can pass a plain object. */
export interface KeyboardPlatform {
  /** Chromium's replacement for the frozen `navigator.platform`. */
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
}

/** macOS, and the iPhone/iPad values older Safaris report. */
const APPLE = /^(mac|iphone|ipad|ipod)/i;

/**
 * True only when the platform is *known* to be an Apple one. Anything else —
 * Windows, Linux, Android, or a browser that reports nothing useful — is false,
 * because Ctrl is the safe answer when we cannot tell.
 *
 * iPadOS 13+ reports `MacIntel`, which is the right answer anyway: an iPad
 * keyboard has a Command key.
 */
export function hasCommandKey(nav: KeyboardPlatform = navigator): boolean {
  const reported = nav.userAgentData?.platform ?? nav.platform;
  if (reported) return APPLE.test(reported);
  // Every engine still ships a user-agent string, so this is the last resort
  // rather than a preference.
  return /\b(Macintosh|Mac OS X|iPhone|iPad|iPod)\b/.test(nav.userAgent ?? '');
}

/** How to write "save" as a chord: `⌘↵` on a Mac, `Ctrl+Enter` everywhere else. */
export function saveShortcutLabel(nav: KeyboardPlatform = navigator): string {
  return hasCommandKey(nav) ? '⌘↵' : 'Ctrl+Enter';
}
