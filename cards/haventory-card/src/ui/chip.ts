import { css, html, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

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
 *   affordance. They are tag chips like any other and take these metrics
 *   unchanged; only the remove button is theirs.
 * - `.hv-area-chip` marks the HA area beside a location path. It shares the
 *   metrics so it sits level with the chips around it, and keeps its own glyph
 *   and spelled-out label, because an area is not one of the facts above.
 * - `.hv-status-chip` reports an item's status. It shares the metrics for the
 *   same reason and opts out of the hue vocabulary below, because a household
 *   chooses what colour each status is. Opting out only holds if the two
 *   palettes stay apart, so the status tones in `tokens` are offset from the
 *   fills here — see the note on that block.
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
   * The two chips whose label a household writes — a status it named, an HA
   * area it named — and which therefore have no length this card can rely on.
   *
   * Both have to be allowed to shrink for their label to elide at all: the
   * metrics above hold every chip at flex: none, which is right beside other
   * chips and wrong inside a box narrower than the chip. Left unshrunk they do
   * not merely spill: the location tree's area band paints its name over the
   * tally beside it, and a clipped number reads as a smaller one with nothing
   * to say it was cut.
   *
   * The elision belongs on the label, not on the box around it: the chip is an
   * inline-flex container, so text-overflow on an ancestor cannot reach into it
   * and text-overflow on the chip itself does nothing. As a flex item the label
   * is a block container already, so only the shrink and the overflow are
   * needed. The glyph and the screen-reader word stay outside the label, which
   * is why every caller renders the name in its own element.
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

  /* What the hue means is fixed card-wide: blue for something the item itself
     carries — the state it is in, the tags on it — amber for a chore on
     something still on the shelf (low stock, an inspection that has come due),
     red for an item that is out and late back. Keeping amber and red apart is
     what lets both sit in one row without reading as a single alarm.

     Blue covers two of those, so the fill is not what tells them apart: a tag
     carries a leading # and a state chip carries none. Category is the third
     thing that shares those rows and takes no hue at all, which is what a
     neutral chip means here — a value with nothing to report about it.

     .hv-status-chip at the foot of this file is the one exception, taking its
     colour from the status definition instead. That is why it is a separate
     class: a user-chosen hue inside this vocabulary would dissolve it, which
     is also why the tone palette it draws from is offset from these fills. */
  .hv-chip.state {
    background: var(--hv-primary-tint);
    color: var(--hv-on-primary-tint);
    border-color: transparent;
  }
  /* A tag reads the same on every surface that prints one. Held off the
     pressable variant because the filter panel offers tags as choices rather
     than reporting them, and a group of them pre-filled blue would read as
     already applied — there the # is the whole distinction from the category
     chips beside it. */
  .hv-chip.tag:not(.toggle) {
    background: var(--hv-primary-tint);
    color: var(--hv-on-primary-tint);
    border-color: transparent;
  }
  /* The mark that names the facet without colour, so the distinction survives
     greyscale and a colourblind reader. A shade back, because the value is
     what is being read; not far enough back to stop carrying the distinction
     on its own. */
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
  /* Present but unremarkable — the "OK" in a status column, the "no area" tail
     of the location tree. It holds the chip's place in a run of them without
     claiming the attention a filled one does. */
  .hv-chip.quiet,
  .hv-area-chip.quiet {
    background: none;
    /* Secondary rather than tertiary ink: with no fill of its own this label is
       read against the page, where the tertiary grey lands at 2.7:1. */
    color: var(--hv-text-secondary);
    border-color: var(--hv-divider);
  }

  /*
   * Applied. One signal for it card-wide: a ring, which is the only mark
   * available to a chip whose fill already names its facet.
   *
   * A chip with no hue of its own fills as well, or the ring would be drawn
   * around nothing. The two rules below restate their own hue for the same
   * reason the ordering note above exists: toggle-and-on is a three-class
   * selector and would otherwise repaint a hued chip blue. The status chip
   * cannot restate per tone — a household can pick a #rrggbb literal no class
   * covers — so its rule further down reads the same two custom properties
   * every route into its colour already sets.
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
   * The status chip — the one mark on the card whose colour a household picks.
   *
   * It shares the metrics above and opts out of the hue vocabulary, the way
   * .hv-area-chip does. It has to: the hues above mean something fixed, and a
   * status painted from that palette would claim a meaning its label already
   * carries — a green "OK" beside an amber "Low stock" would read as two points
   * on one scale rather than two unrelated facts.
   *
   * Opting out is a property of the tones, not of this class: a tone that
   * resolved to one of the fills above would collide with it wherever the two
   * share a row, so the blue tones in ui/tokens are held off both the state
   * chip's tint and the primary fill every action wears.
   *
   * Each tone comes in a light and a strong form. Strong exists so an urgent
   * status can carry further than a routine one in a dense row.
   *
   * The fill and its ink arrive as two custom properties, whatever set them: a
   * tone class below, or an inline declaration when a household picked a
   * literal colour instead of one of the tones. One route in, so a rule built
   * on the pair holds for both.
   */
  .hv-status-chip {
    gap: 4px;
    background: var(--hv-status-bg, var(--hv-tone-neutral-bg));
    color: var(--hv-status-fg, var(--hv-tone-neutral-fg));
  }
  /* Selected, it keeps its own colour — the hue is what says which status was
     picked, so painting it primary blue erases the answer at the moment it is
     given. Reading the custom-property pair covers every tone class and any
     inline #rrggbb literal in one rule; source order past .hv-chip.toggle.on
     is what lets this equal-specificity selector win. The fallback is the
     plain applied fill, for the default status, which carries no hue. */
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
   * A line a chip shares with the text it qualifies — an area beside its path,
   * a breadcrumb.
   *
   * The row centres the two against each other, which no inline alignment can:
   * vertical-align: middle puts an inline box on the parent's baseline plus
   * half its x-height, which is the middle of lowercase text and not the middle
   * of the line. Beside a path with capitals and digits in it that leaves the
   * chip sitting low, and the offset does not shrink as the chip does, because
   * it is a property of the text.
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

/**
 * The glyph a tag is written with, here and in the applied-filters row, where
 * a chip's label is a plain string and cannot carry the element below.
 */
export const TAG_MARK = '#';

/**
 * A tag's name with its mark, for a chip that carries more than the name —
 * the editor's removable token, the filter panel's pressable chip.
 *
 * The two sit in one inline box because a chip is a flex row with a gap
 * between its items, and the gap differs by surface: as separate items they
 * would read "# spare" here and "#  spare" in the filter panel. The mark is
 * out of the accessible name, where it would be read as part of the tag.
 */
export function tagLabel(value: string): TemplateResult {
  return html`<span><span class="hv-tag-mark" aria-hidden="true">${TAG_MARK}</span>${value}</span>`;
}

/**
 * A tag, reported. Every surface that prints one calls this, so a tag cannot
 * come out grey on one of them and blue on the next — the same reason
 * `renderAreaChip` and `renderStatusChip` exist.
 */
export function renderTagChip(value: string, testid?: string): TemplateResult {
  return html`<span class="hv-chip tag" data-testid=${ifDefined(testid)}>${tagLabel(value)}</span>`;
}
