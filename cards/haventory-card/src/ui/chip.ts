import { css } from 'lit';

/**
 * The card's chip vocabulary: the small pill that reports one fact beside the
 * thing it qualifies — low stock, a status, a tag, an applied filter.
 *
 * Every such mark on the card is one of these, at one size, so that a row
 * carrying several of them reads as a set rather than as four unrelated marks.
 * Metrics come from `--hv-chip-*` in `tokens`; a surface that must size its
 * chips to something beside them overrides `font-size` on its own rule and says
 * why, rather than restating the whole block.
 *
 * Four things are deliberately *not* this chip:
 *
 * - `.hv-pill` in `tokens` is an action — a button shaped like a pill. A chip
 *   reports; a pill does something.
 * - `hv-chip-input`'s tokens are editable input values with a remove
 *   affordance. They take these metrics and own their own interaction.
 * - `.hv-area-chip` marks the HA area beside a location path. It shares the
 *   metrics so it sits level with the chips around it, and keeps its own glyph
 *   and spelled-out label, because an area is not one of the facts above.
 * - `.hv-status-chip` reports an item's status. It shares the metrics for the
 *   same reason and opts out of the hue vocabulary below, because a household
 *   chooses what colour each status is.
 *
 * Usage: `static styles = [tokens, base, chip, css\`...\`]`.
 */
export const chip = css`
  .hv-chip,
  .hv-area-chip,
  .hv-status-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    /* The transparent border is what keeps a bordered chip the same height as a
       filled one sitting next to it in the same row. */
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: var(--hv-radius-chip);
    padding: var(--hv-chip-padding);
    background: var(--hv-chip-bg);
    color: var(--hv-chip-text);
    font-family: var(--hv-font);
    font-size: var(--hv-chip-font-size);
    font-weight: 500;
    /* Fixed rather than inherited: these ride inside rows whose line-height
       varies, and a chip that changed height with its host row would break the
       run of chips beside it. */
    line-height: 1.4;
    /* Chips sit inside single-line rows that clip with an ellipsis; a wrap would
       grow the line box those rows size themselves from. */
    white-space: nowrap;
    vertical-align: middle;
  }

  /*
   * Pressable. Reads as an empty outline until it carries a hue or is applied,
   * so a row of them says "these are choices" rather than "these are facts".
   *
   * The hue variants below must come after this rule: a pressable chip can
   * carry one, and both are two-class selectors, so source order is what
   * decides which fill a pressable warning chip gets.
   */
  .hv-chip.toggle {
    cursor: pointer;
    background: none;
    color: var(--hv-text-secondary);
    border-color: var(--hv-divider);
  }
  .hv-chip.toggle:hover {
    background: var(--hv-hover-overlay);
  }

  /* What the hue means is fixed card-wide: blue for a state the item is in,
     amber for a chore on something still on the shelf (low stock, an inspection
     that has come due), red for an item that is out and late back. Keeping
     amber and red apart is what lets both sit in one row without reading as a
     single alarm.

     .hv-status-chip at the foot of this file is the one exception, taking its
     colour from the status definition instead. That is why it is a separate
     class: a user-chosen hue inside this vocabulary would dissolve it. */
  .hv-chip.state {
    background: var(--hv-primary-tint);
    color: var(--hv-primary-darker);
    border-color: transparent;
  }
  .hv-chip.warning {
    background: var(--hv-warn-bg);
    color: var(--hv-warn-deep);
    border-color: transparent;
  }
  .hv-chip.error {
    background: var(--hv-error-bg);
    color: var(--hv-error-deep);
    border-color: transparent;
  }
  /* Present but unremarkable — the "OK" in a status column, the "no area" tail
     of the location tree. It holds the chip's place in a run of them without
     claiming the attention a filled one does. */
  .hv-chip.quiet,
  .hv-area-chip.quiet {
    background: none;
    color: var(--hv-text-tertiary);
    border-color: var(--hv-divider);
  }

  /*
   * Applied. One signal for it card-wide: a ring, which is the only mark
   * available to a chip whose fill already names its facet.
   *
   * A chip with no hue of its own fills as well, or the ring would be drawn
   * around nothing. The two rules below restate their own hue for the same
   * reason the ordering note above exists: toggle-and-on is a three-class
   * selector and would otherwise repaint a hued chip blue.
   */
  .hv-chip.on {
    outline: 2px solid var(--hv-primary);
    outline-offset: 1px;
  }
  .hv-chip.toggle.on {
    background: var(--hv-primary-tint);
    color: var(--hv-primary-darker);
    border-color: transparent;
  }
  .hv-chip.toggle.warning.on {
    background: var(--hv-warn-bg);
    color: var(--hv-warn-deep);
  }
  .hv-chip.toggle.error.on {
    background: var(--hv-error-bg);
    color: var(--hv-error-deep);
  }

  .hv-chip[disabled] {
    opacity: 0.5;
    cursor: default;
  }

  /*
   * The status chip — the one mark on the card whose colour a household picks.
   *
   * It shares the metrics above and opts out of the hue vocabulary, the way
   * .hv-area-chip does. It has to: the hues above mean something fixed, and a
   * status painted from that palette would claim a meaning its label already
   * carries — a green "OK" beside an amber "Low stock" would read as two points
   * on one scale rather than two unrelated facts.
   *
   * Each tone comes in a light and a strong form. Strong exists so an urgent
   * status can carry further than a routine one in a dense row.
   */
  .hv-status-chip {
    gap: 4px;
    background: var(--hv-tone-neutral-bg);
    color: var(--hv-tone-neutral-fg);
  }
  .hv-status-chip.tone-neutral {
    background: var(--hv-tone-neutral-bg);
    color: var(--hv-tone-neutral-fg);
  }
  .hv-status-chip.tone-green {
    background: var(--hv-tone-green-bg);
    color: var(--hv-tone-green-fg);
  }
  .hv-status-chip.tone-blue {
    background: var(--hv-tone-blue-bg);
    color: var(--hv-tone-blue-fg);
  }
  .hv-status-chip.tone-amber {
    background: var(--hv-tone-amber-bg);
    color: var(--hv-tone-amber-fg);
  }
  .hv-status-chip.tone-red {
    background: var(--hv-tone-red-bg);
    color: var(--hv-tone-red-fg);
  }
  .hv-status-chip.tone-neutral-strong {
    background: var(--hv-tone-neutral-strong-bg);
    color: var(--hv-tone-neutral-strong-fg);
  }
  .hv-status-chip.tone-green-strong {
    background: var(--hv-tone-green-strong-bg);
    color: var(--hv-tone-green-strong-fg);
  }
  .hv-status-chip.tone-blue-strong {
    background: var(--hv-tone-blue-strong-bg);
    color: var(--hv-tone-blue-strong-fg);
  }
  .hv-status-chip.tone-amber-strong {
    background: var(--hv-tone-amber-strong-bg);
    color: var(--hv-tone-amber-strong-fg);
  }
  .hv-status-chip.tone-red-strong {
    background: var(--hv-tone-red-strong-bg);
    color: var(--hv-tone-red-strong-fg);
  }

  /*
   * A line a chip shares with the text it qualifies — an area beside its path,
   * a breadcrumb.
   *
   * The row centres the two against each other, which no inline alignment can:
   * vertical-align: middle puts an inline box on the parent's baseline plus
   * half its x-height, which is the middle of lowercase text and not the middle
   * of the line. Beside a path with capitals and digits in it that leaves the
   * chip sitting low — measured at 1.4px against 13.5px text, and it does not
   * shrink as the chip does, because the offset is a property of the text.
   *
   * The elision has to move onto the text with it: text-overflow has no
   * effect on a flex container, so a path left on the row itself would hard-cut
   * mid-character with no ellipsis to say anything had been dropped.
   */
  .hv-chip-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .hv-chip-line > .hv-chip-line-text {
    min-width: 0;
  }
`;
