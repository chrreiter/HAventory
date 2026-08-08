/**
 * Fallback heading for the card and its full view.
 *
 * The real heading comes from the dashboard's `title:` or from the
 * integration's `card_title` option; this covers the render that happens
 * before either is known. It must match `DEFAULT_CARD_TITLE` in the
 * integration's `const.py`, so both ends agree on what "unset" looks like.
 */
export const DEFAULT_CARD_TITLE = 'HAventory';
