import { t } from '../i18n';

/**
 * The one question asked before typed edits are thrown away, whichever control
 * would lose them. A function because the language arrives after this module
 * is evaluated. Spread into `HostSurfaces.confirm()` beside an `onConfirm`.
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
 * Put the discard question and run `onConfirm` on a yes. Asked by the element
 * hosting the form, because the question must outlive the surface that raised it.
 */
export type ConfirmDiscard = (onConfirm: () => void) => void;
