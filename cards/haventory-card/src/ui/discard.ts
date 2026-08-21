import { t } from '../i18n';

/**
 * The one question asked before typed edits are thrown away.
 *
 * Every path that would lose a dirty form asks it: the form's own Cancel, ✕ and
 * Escape, a sheet's scrim tap and swipe-down, a switch to another row, the full
 * view's backdrop, Escape and close button. One wording, so the same decision
 * never reads as a different question depending on which control the user
 * reached for.
 *
 * A function rather than a constant: the language is not known when this module
 * is evaluated — Home Assistant hands it over in `set hass`, which is long
 * after — so a constant here would freeze the English strings into every
 * surface that spreads it.
 *
 * Spread into `HostSurfaces.confirm()` alongside an `onConfirm`, or bound field
 * by field onto an `hv-confirm`.
 */
export function discardPrompt(): {
  heading: string;
  message: string;
  confirmLabel: string;
  destructive: true;
} {
  return {
    heading: t('hv.discard.heading'),
    message: t('hv.discard.message'),
    confirmLabel: t('hv.action.discard'),
    destructive: true,
  };
}
