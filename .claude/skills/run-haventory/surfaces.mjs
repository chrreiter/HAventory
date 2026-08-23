// The surfaces a visual pass walks: named recipes of clicks against the card's
// and the panel's own `data-testid`s, one table per layout branch.
//
// They live apart from the runner because they are data, and because a test can
// then check the tables about themselves — `card_views.test.mjs` asserts that
// every desktop surface says something the narrow branch cannot, which is the
// property that makes a desktop pass fail when it lands on the wrong layout.

// --- surface recipes ------------------------------------------------------
// `open` is a list of steps run in order against the pass's root element:
//   ["click", <sel>]  ["hover", <sel>]  ["fill", <sel>, <text>]  ["key", <key>]  ["wait", <ms>]
// `expect` is the selector — or list of selectors — that must be visible once the
// recipe has run; `hidden` is the optional counterpart, for a layout whose point
// is that something is gone. Selectors pierce shadow DOM, so nested components
// address directly.
//
// Every recipe starts from a freshly loaded page. Chaining them instead would be
// faster, but a modal left standing puts a scrim over everything that follows
// and one failure then cascades into a dozen — which reads as a broken card
// rather than a broken recipe. That is why the full-view surfaces each re-open
// the full view rather than assuming the previous surface left it up.
//
// Surfaces are named after what a reader would call the screen, and prefixed
// d-/m-/p-/pm- in the file name so the desktop, mobile and the two panel
// captures of the same surface sort next to each other.
//
// The card chooses its layout from ITS OWN width, not the viewport's, so the
// desktop pass runs on a panel-mode view: in a normal dashboard column even a
// 1440px window gets the narrow branch, where the filter panel is a modal sheet
// and the full-view link is absent entirely. Which view that is, on this
// instance, is discovered — see card_views.mjs.
//
// Each pass names the root element it waits for and scopes its selectors to:
// the sidebar panel at /haventory is a different custom element and renders no
// card at all, so waiting for `haventory-card` there only ever times out.
export const CARD = "haventory-card";
export const PANEL = "haventory-panel";
const OVERFLOW = `${CARD} [data-testid="card-overflow"] button`;
const menu = (id) => `${CARD} [data-testid="overflow-item"][data-id="${id}"]`;

// Opening the full view is a shared prefix, not a surface the later ones inherit.
const OPEN_FULL = [
  ["click", `${CARD} [data-testid="expand-toggle"]`],
  ["wait", 1500],
];

export const DESKTOP_SURFACES = [
  { id: "01-list", open: [], expect: `${CARD} [data-testid="card-list"]` },
  {
    id: "02-filter-panel",
    open: [["click", `${CARD} [data-testid="filter-toggle"]`]],
    expect: `${CARD} [data-testid="filter-panel"]`,
    // The narrow branch mounts this same `hv-filter-panel` inside the filter
    // sheet, so `filter-panel` alone would pass on either layout. The desktop
    // panel applies each change as it is made and renders no footer; the
    // sheet's Apply button is therefore precisely "this is not the sheet".
    hidden: `${CARD} [data-testid="sheet-apply"]`,
  },
  {
    id: "03-search",
    open: [
      ["fill", `${CARD} [data-testid="search-input"]`, "box"],
      ["wait", 1500],
    ],
    expect: `${CARD} [data-testid="card-list"]`,
  },
  {
    id: "04-add-editor",
    open: [["click", `${CARD} [data-testid="add-item"]`]],
    expect: `${CARD} [data-testid="item-editor"]`,
  },
  {
    id: "05-row-editor",
    // The row's edit button lives in `.hover-actions` and is transparent until
    // the row is hovered, so it has to be revealed before it can be clicked.
    open: [
      ["hover", `${CARD} [data-testid="list-row"]`],
      ["click", `${CARD} [data-testid="list-row"] [data-testid="row-edit"]`],
    ],
    expect: `${CARD} [data-testid="item-editor"]`,
  },
  {
    id: "06-overflow",
    open: [["click", OVERFLOW]],
    expect: `${CARD} [data-testid="overflow-menu"]`,
  },
  {
    id: "07-organize",
    open: [
      ["click", OVERFLOW],
      ["click", menu("organize")],
      ["wait", 800],
    ],
    expect: `${CARD} [data-testid="organize-dialog"]`,
  },
  {
    id: "08-diagnostics",
    open: [
      ["click", OVERFLOW],
      ["click", menu("diagnostics")],
      ["wait", 800],
    ],
    // The panel host is a zero-size wrapper; its status line is what proves the
    // panel is actually open.
    expect: `${CARD} [data-testid="diagnostics-status"]`,
  },
  {
    id: "09-import",
    open: [
      ["click", OVERFLOW],
      ["click", menu("import")],
    ],
    expect: `${CARD} [data-testid="import-text"]`,
  },
  {
    id: "10-selection",
    // Selection mode is entered from the menu; the per-row checkboxes do not
    // exist until it is on.
    open: [
      ["click", OVERFLOW],
      ["click", menu("select-items")],
      ["wait", 700],
    ],
    expect: `${CARD} [data-testid="selection-bar"], ${CARD} [data-testid="bulk-bar"]`,
  },
  {
    id: "11-full-view",
    // `expand-toggle` is the app-bar control and exists at every width;
    // `open-full-view` is a footer link the narrow branch does not render.
    open: OPEN_FULL,
    // `full-view` alone opens on either layout: it is a modal at any width, and
    // `hv-full-view` sizes its own sidebar off the window rather than off the
    // card, so even the sidebar is present when a narrow card opens it in a
    // wide window. The footer link is the one thing here that the card's own
    // branch decides — `hv-card-shell` renders it only when it is not mobile —
    // and the shell stays in the DOM under the modal. The sidebar is asserted
    // beside it as the mirror of the panel-mobile page surface, which asserts
    // that same element hidden.
    expect: [
      `${CARD} [data-testid="full-view"]`,
      `${CARD} [data-testid="full-sidebar"]`,
      `${CARD} [data-testid="open-full-view"]`,
    ],
  },
  {
    id: "12-full-filters",
    open: [...OPEN_FULL, ["click", `${CARD} [data-testid="full-filters-toggle"]`], ["wait", 500]],
    expect: `${CARD} [data-testid="full-filter-panel"]`,
  },
  {
    id: "13-full-editor",
    open: [...OPEN_FULL, ["click", `${CARD} [data-testid="full-add-item"]`], ["wait", 600]],
    expect: `${CARD} [data-testid="item-editor"]`,
  },
  {
    id: "14-full-columns",
    open: [...OPEN_FULL, ["click", `${CARD} [data-testid="columns-expanded"]`], ["wait", 600]],
    expect: `${CARD} [data-testid="column-options"]`,
  },
];

// The narrow layout is a different component tree, not a reflow: the filter
// panel becomes a sheet, the row opens a detail sheet, and the editor arrives as
// a bottom sheet. Recipes that only exist here live in their own list.
export const MOBILE_SURFACES = [
  { id: "01-list", open: [], expect: `${CARD} [data-testid="card-list"]` },
  {
    id: "02-filter-sheet",
    open: [
      ["click", `${CARD} [data-testid="filter-toggle"]`],
      ["wait", 600],
    ],
    // `filter-sheet` is the bottom-sheet host and has no box of its own, so the
    // sheet's own footer buttons are what prove it came up — and they are what
    // the desktop filter-panel surface asserts are absent.
    expect: [`${CARD} [data-testid="sheet-cancel"]`, `${CARD} [data-testid="sheet-apply"]`],
    // A modal sheet is not dismissed by pressing its opener again — leaving it
    // up would put a scrim over every surface that follows.
  },
  {
    id: "03-detail-sheet",
    open: [
      ["click", `${CARD} [data-testid="list-row"] [data-testid="row-name"]`],
      ["wait", 700],
    ],
    expect: `${CARD} [data-testid="sheet-name"]`,
  },
  {
    id: "04-add-sheet",
    open: [
      ["click", `${CARD} [data-testid="add-item"]`],
      ["wait", 700],
    ],
    expect: `${CARD} [data-testid="item-editor"]`,
  },
  {
    id: "05-overflow",
    open: [["click", OVERFLOW]],
    expect: `${CARD} [data-testid="overflow-menu"]`,
  },
  {
    id: "06-organize",
    open: [
      ["click", OVERFLOW],
      ["click", menu("organize")],
      ["wait", 900],
    ],
    expect: `${CARD} [data-testid="organize-dialog"]`,
  },
  {
    id: "07-diagnostics",
    open: [
      ["click", OVERFLOW],
      ["click", menu("diagnostics")],
      ["wait", 800],
    ],
    expect: `${CARD} [data-testid="diagnostics-status"]`,
  },
  {
    id: "08-full-view",
    open: [
      ["click", `${CARD} [data-testid="expand-toggle"]`],
      ["wait", 1500],
    ],
    expect: `${CARD} [data-testid="full-view"]`,
  },
];

// The sidebar panel embeds the same full view the card opens in a modal, so its
// inner testids are the full view's — but the surrounding host is `haventory-panel`
// with its own dialog set, which is exactly what these recipes prove. The panel's
// overflow lives on the full view's app bar, not behind the card's `card-overflow`.
const PANEL_OVERFLOW = `${PANEL} [data-testid="full-overflow"] [data-testid="overflow-trigger"]`;
const panelMenu = (id) => `${PANEL} [data-testid="overflow-item"][data-id="${id}"]`;

export const PANEL_SURFACES = [
  { id: "01-page", open: [], expect: `${PANEL} [data-testid="full-table"]` },
  {
    id: "02-filters",
    open: [["click", `${PANEL} [data-testid="full-filters-toggle"]`], ["wait", 500]],
    expect: `${PANEL} [data-testid="full-filter-panel"]`,
  },
  {
    id: "03-search",
    open: [
      ["fill", `${PANEL} [data-testid="full-search"]`, "box"],
      ["wait", 1500],
    ],
    expect: `${PANEL} [data-testid="full-table"]`,
  },
  {
    id: "04-add-editor",
    open: [["click", `${PANEL} [data-testid="full-add-item"]`], ["wait", 600]],
    expect: `${PANEL} [data-testid="item-editor"]`,
  },
  {
    id: "05-row-editor",
    // The table's row actions are `visibility: hidden` until the row is
    // hovered, so the edit button has to be revealed before it can be clicked.
    open: [
      ["hover", `${PANEL} [data-testid="table-row"]`],
      ["click", `${PANEL} [data-testid="table-edit"]`],
      ["wait", 600],
    ],
    expect: `${PANEL} [data-testid="item-editor"]`,
  },
  {
    id: "06-overflow",
    open: [["click", PANEL_OVERFLOW]],
    expect: `${PANEL} [data-testid="overflow-menu"]`,
  },
  {
    id: "07-organize",
    open: [
      ["click", PANEL_OVERFLOW],
      ["click", panelMenu("organize")],
      ["wait", 800],
    ],
    expect: `${PANEL} [data-testid="organize-dialog"]`,
  },
  {
    id: "08-columns",
    open: [["click", `${PANEL} [data-testid="columns-expanded"]`], ["wait", 600]],
    expect: `${PANEL} [data-testid="column-options"]`,
  },
  {
    id: "09-diagnostics",
    open: [
      ["click", PANEL_OVERFLOW],
      ["click", panelMenu("diagnostics")],
      ["wait", 800],
    ],
    expect: `${PANEL} [data-testid="diagnostics-status"]`,
  },
  {
    id: "10-import",
    open: [
      ["click", PANEL_OVERFLOW],
      ["click", panelMenu("import")],
    ],
    expect: `${PANEL} [data-testid="import-text"]`,
  },
];

// The panel on a phone. Unlike the card, whose narrow layout is a different
// component tree, `hv-full-view` keeps one tree and switches on a media query at
// 700px — so these are the panel recipes again, at a width where that branch is
// live, plus the three assertions that only hold there: the sidebar is gone, the
// filter panel grows a staged apply/cancel footer, and the app bar trades the
// close button for the button that reopens Home Assistant's own drawer (which a
// panel must offer itself once HA has collapsed it).
export const PANEL_MOBILE_SURFACES = [
  {
    id: "01-page",
    open: [],
    expect: [`${PANEL} [data-testid="full-table"]`, `${PANEL} [data-testid="panel-menu"]`],
    hidden: `${PANEL} [data-testid="full-sidebar"]`,
  },
  {
    id: "02-filters",
    open: [["click", `${PANEL} [data-testid="full-filters-toggle"]`], ["wait", 500]],
    // The footer is the narrow branch's own: the wide panel applies each change
    // as it is made, this one stages them behind Apply.
    expect: [`${PANEL} [data-testid="full-filter-panel"]`, `${PANEL} [data-testid="full-panel-foot"]`],
  },
  {
    id: "03-search",
    open: [
      ["fill", `${PANEL} [data-testid="full-search"]`, "box"],
      ["wait", 1500],
    ],
    expect: `${PANEL} [data-testid="full-table"]`,
  },
  {
    id: "04-add-editor",
    open: [["click", `${PANEL} [data-testid="full-add-item"]`], ["wait", 600]],
    expect: `${PANEL} [data-testid="item-editor"]`,
  },
  {
    id: "05-row-editor",
    // At this width the table is off the side of the screen, so it cannot be
    // the read view: opening a row lands on the detail sheet, and the form is
    // one tap deeper inside it. The pencil goes the same way as the row itself,
    // which is the point of the one method that decides.
    open: [
      ["hover", `${PANEL} [data-testid="table-row"]`],
      ["click", `${PANEL} [data-testid="table-edit"]`],
      ["wait", 800],
      ["click", `${PANEL} [data-testid="sheet-edit-details"]`],
      ["wait", 600],
    ],
    // The sheet's own back arrow, not its host element: `hv-bottom-sheet` draws
    // its panel in its shadow root and the host itself has no box to wait for.
    expect: [`${PANEL} [data-testid="sheet-back"]`, `${PANEL} [data-testid="item-editor"]`],
  },
  {
    id: "06-overflow",
    open: [["click", PANEL_OVERFLOW]],
    expect: `${PANEL} [data-testid="overflow-menu"]`,
  },
  {
    id: "07-organize",
    open: [
      ["click", PANEL_OVERFLOW],
      ["click", panelMenu("organize")],
      ["wait", 800],
    ],
    expect: `${PANEL} [data-testid="organize-dialog"]`,
  },
  {
    id: "08-columns",
    // Through the overflow menu: under 700px the context bar renders no
    // columns button, and the menu's Columns entry is the one route there.
    open: [["click", PANEL_OVERFLOW], ["click", panelMenu("columns")], ["wait", 600]],
    expect: `${PANEL} [data-testid="column-options"]`,
  },
];
