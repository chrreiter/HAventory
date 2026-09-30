import { css, html, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

/**
 * The card's chip vocabulary: the small pill that reports one fact beside the
 * thing it qualifies, at one size everywhere, with metrics from `--hv-chip-*`.
 * `.hv-pill` is an action, not a chip. `.hv-area-chip` and `.hv-status-chip`
 * share the metrics but not the hue vocabulary below.
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
    /* Keeps a bordered chip as tall as a filled one beside it. */
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: var(--hv-radius-chip);
    padding: var(--hv-chip-padding);
    background: var(--hv-chip-bg);
    color: var(--hv-chip-text);
    font-family: var(--hv-font);
    font-size: var(--hv-chip-font-size);
    font-weight: 500;
    /* Fixed, so a chip keeps one height whatever row it rides in. */
    line-height: 1.4;
    white-space: nowrap;
    vertical-align: middle;
  }

  /*
   * A household writes these labels, so they must shrink and elide rather than
   * spill over a tally beside them. text-overflow cannot act on an inline-flex
   * box, so the elision sits on the label element inside it.
   */
  .hv-area-chip,
  .hv-status-chip {
    max-width: 100%;
  }
  .hv-area-chip > .hv-chip-text,
  .hv-status-chip > .hv-chip-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /*
   * Pressable: an empty outline until hued or applied. The hue variants must
   * come after this rule, since source order settles the equal specificity.
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

  /* Fixed hues card-wide: blue for what the item carries (its state, its tags,
     told apart by the tag's #), amber for a chore on the shelf, red for an item
     out and late. A category takes no hue. */
  .hv-chip.state {
    background: var(--hv-primary-tint);
    color: var(--hv-on-primary-tint);
    border-color: transparent;
  }
  /* Not on the pressable variant: pre-filled blue choices would read as applied. */
  .hv-chip.tag:not(.toggle) {
    background: var(--hv-primary-tint);
    color: var(--hv-on-primary-tint);
    border-color: transparent;
  }
  /* The # tells a tag apart without colour. */
  .hv-tag-mark {
    opacity: 0.75;
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
  /* Present but unremarkable, like an "OK" in a status column. */
  .hv-chip.quiet,
  .hv-area-chip.quiet {
    background: none;
    /* Tertiary grey lands at 2.7:1 against the page. */
    color: var(--hv-text-secondary);
    border-color: var(--hv-divider);
  }

  /*
   * Applied: a ring, card-wide. A hueless chip fills too; the hued ones restate
   * their fill, since the three-class toggle-and-on rule would paint them blue.
   */
  .hv-chip.on {
    outline: 2px solid var(--hv-primary);
    outline-offset: 1px;
  }
  .hv-chip.toggle.on {
    background: var(--hv-primary-tint);
    color: var(--hv-on-primary-tint);
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
   * The status chip, whose colour a household picks. Its tones in ui/tokens are
   * held off the fixed hues above so the two never collide in a row. A tone
   * class or an inline #rrggbb literal both set the same two properties.
   */
  .hv-status-chip {
    gap: 4px;
    background: var(--hv-status-bg, var(--hv-tone-neutral-bg));
    color: var(--hv-status-fg, var(--hv-tone-neutral-fg));
  }
  /* Selected, it keeps its own colour; source order after .hv-chip.toggle.on wins. */
  .hv-status-chip.toggle.on {
    background: var(--hv-status-bg, var(--hv-primary-tint));
    color: var(--hv-status-fg, var(--hv-on-primary-tint));
  }
  .hv-status-chip.tone-neutral {
    --hv-status-bg: var(--hv-tone-neutral-bg);
    --hv-status-fg: var(--hv-tone-neutral-fg);
  }
  .hv-status-chip.tone-green {
    --hv-status-bg: var(--hv-tone-green-bg);
    --hv-status-fg: var(--hv-tone-green-fg);
  }
  .hv-status-chip.tone-blue {
    --hv-status-bg: var(--hv-tone-blue-bg);
    --hv-status-fg: var(--hv-tone-blue-fg);
  }
  .hv-status-chip.tone-amber {
    --hv-status-bg: var(--hv-tone-amber-bg);
    --hv-status-fg: var(--hv-tone-amber-fg);
  }
  .hv-status-chip.tone-red {
    --hv-status-bg: var(--hv-tone-red-bg);
    --hv-status-fg: var(--hv-tone-red-fg);
  }
  .hv-status-chip.tone-neutral-strong {
    --hv-status-bg: var(--hv-tone-neutral-strong-bg);
    --hv-status-fg: var(--hv-tone-neutral-strong-fg);
  }
  .hv-status-chip.tone-green-strong {
    --hv-status-bg: var(--hv-tone-green-strong-bg);
    --hv-status-fg: var(--hv-tone-green-strong-fg);
  }
  .hv-status-chip.tone-blue-strong {
    --hv-status-bg: var(--hv-tone-blue-strong-bg);
    --hv-status-fg: var(--hv-tone-blue-strong-fg);
  }
  .hv-status-chip.tone-amber-strong {
    --hv-status-bg: var(--hv-tone-amber-strong-bg);
    --hv-status-fg: var(--hv-tone-amber-strong-fg);
  }
  .hv-status-chip.tone-red-strong {
    --hv-status-bg: var(--hv-tone-red-strong-bg);
    --hv-status-fg: var(--hv-tone-red-strong-fg);
  }

  /*
   * A chip beside the text it qualifies, centred by flex (vertical-align: middle
   * sits low beside capitals). The text elides in its own element.
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

/** The glyph a tag is written with. */
export const TAG_MARK = '#';

/**
 * A tag's name with its mark in one inline box, so the chip's flex gap does not
 * split them; the mark is kept out of the accessible name.
 */
export function tagLabel(value: string): TemplateResult {
  return html`<span><span class="hv-tag-mark" aria-hidden="true">${TAG_MARK}</span>${value}</span>`;
}

/** A tag, reported, the same on every surface. */
export function renderTagChip(value: string, testid?: string): TemplateResult {
  return html`<span class="hv-chip tag" data-testid=${ifDefined(testid)}>${tagLabel(value)}</span>`;
}
