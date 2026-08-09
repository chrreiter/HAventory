import { css } from 'lit';

/**
 * The phone presentation shared by the host dialogs: `hv-column-picker`,
 * `hv-confirm`, `hv-import-sheet` and `hv-diagnostics-panel`.
 *
 * A centred 330–500px box is a desktop shape. At 390px it leaves a strip of
 * page either side of a dialog that is effectively full width anyway, and it
 * arrives from the middle of the screen while the filter panel, the detail
 * sheet and the ⋮ menu all rise from the bottom edge — the same interaction
 * with two different manners. Under `mobile` these four take the bottom-sheet
 * form instead, so one gesture vocabulary covers every surface on a phone.
 *
 * Added to a component's `static styles` rather than wrapping `hv-bottom-sheet`:
 * each of these dialogs already owns its focus handling, Escape binding and
 * z-order (`nextZBase()`, which is what keeps a confirm above the sheet that
 * raised it), and moving their content into a slot would rebuild all three for
 * a change that is presentational. Each host declares the same two class names
 * — `.wrap` for the centring layer, `.panel` for the box — and this restyles
 * those.
 */
export const dialogSheet = css`
  :host([mobile]) .wrap {
    padding: 0;
    /* Stretched across the bottom edge, not centred in the middle of it. */
    place-items: end stretch;
  }
  :host([mobile]) .panel {
    width: 100%;
    max-width: none;
    /* dvh, not vh: on a phone vh resolves against the viewport with the browser
       chrome retracted, so a tall sheet could stand higher than the screen
       actually showing and push its actions under the URL bar. */
    max-height: 92dvh;
    border-radius: var(--hv-radius-sheet) var(--hv-radius-sheet) 0 0;
    box-shadow: var(--hv-shadow-sheet);
    /* Clears the home indicator on a phone that reports one, and gives the
       bottom row of actions a thumb's worth of air on one that does not. */
    padding-bottom: max(12px, env(safe-area-inset-bottom));
    animation: hv-sheet-rise var(--hv-motion-sheet) var(--hv-ease-out);
  }
  :host([mobile]) .backdrop {
    background: var(--hv-scrim);
  }
  @keyframes hv-sheet-rise {
    from {
      transform: translateY(16px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
`;
