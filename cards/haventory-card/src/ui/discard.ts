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
 * Spread into `HostSurfaces.confirm()` alongside an `onConfirm`; that is the
 * one caller, and `HostSurfaces.confirmDiscard` is how a form reaches it.
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

/**
 * Put the discard question to the user and act on the answer.
 *
 * Forms take this as a property instead of owning a dialog: the question has to
 * survive the surface that raised it — a sheet coming down, a row being
 * switched away from — so it is asked by the element hosting the form, which is
 * still there afterwards. `onConfirm` runs on a yes; a no needs no callback,
 * because the dialog hands focus back to the control the question was raised
 * from by itself.
 */
export type ConfirmDiscard = (onConfirm: () => void) => void;
