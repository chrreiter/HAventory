/**
 * The one question asked before typed edits are thrown away.
 *
 * Every path that would lose a dirty form asks it: the form's own Cancel, ✕ and
 * Escape, a sheet's scrim tap and swipe-down, a switch to another row, the full
 * view's backdrop, Escape and close button. One wording, so the same decision
 * never reads as a different question depending on which control the user
 * reached for.
 *
 * Spread into `HostSurfaces.confirm()` alongside an `onConfirm`, or bound field
 * by field onto an `hv-confirm`.
 */
export const DISCARD_PROMPT = {
  heading: 'Discard your changes?',
  message: 'What you have typed since the last save is lost.',
  confirmLabel: 'Discard',
  destructive: true,
} as const;
