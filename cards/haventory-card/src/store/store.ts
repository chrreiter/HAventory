import type {
  AnyEventPayload,
  AreasListResult,
  AttachmentKind,
  BulkFailure,
  BulkOperation,
  BulkOutcome,
  DegradedState,
  DistinctValue,
  DistinctValues,
  ExportDocument,
  HassLike,
  HealthResult,
  ImportPolicy,
  ImportPreview,
  ImportSummary,
  Item,
  ItemCreate,
  ItemFilter,
  ItemsEventPayload,
  ItemUpdate,
  ListItemsResult,
  LiveUpdatePause,
  Location,
  LocationTreeNode,
  StatsCounts,
  StatusColor,
  StatusDefinition,
  StoreFilters,
  StoreState,
  Unsubscribe,
} from './types';
import { WSClient } from './ws';
import { DEFAULT_SORT } from './sort';
import { normalizeQuickFilters } from '../ui/quick-filters';
import { sortLocationTree } from './location-tree';

/** Page size for the main list. */
const PAGE_LIMIT = 50;

/**
 * Operations per `haventory/items/bulk` call.
 *
 * The endpoint answers a whole batch in one response, so a single call can only
 * ever show an indeterminate spinner. Splitting the work into fixed chunks gives
 * the determinate progress bar the design draws ("Rewriting 24 of 38") and makes
 * "cancel stops after the in-flight batch" literally true.
 */
export const BULK_CHUNK_SIZE = 25;

/**
 * Code for a failure that never came back from the backend at all.
 *
 * Home Assistant rejects a command with the server's own `{code, message}`
 * envelope when the socket carried it, and with a wrapper of its own — numeric
 * code, no top-level message — when the socket did not. Only the first kind
 * says anything about the request, so the second is named for what it is
 * instead of borrowing the taxonomy's `unknown_error` catch-all and reading, to
 * the person in front of it, as a fault in the thing they just did.
 */
const TRANSPORT_ERROR_CODE = 'connection_lost';

/** What a transport failure says out loud; the rejection carries no usable text. */
const TRANSPORT_ERROR_MESSAGE = 'Could not reach Home Assistant — the last action did not go through.';

/** Consecutive transport failures before the card declares the connection lost. */
const CONNECTION_LOST_THRESHOLD = 2;

/**
 * How long a closed socket may stay closed before the card says so.
 *
 * Home Assistant reconnects on its own, and a blip — a suspended tab waking, a
 * proxy recycling — is over before anyone could act on it, so announcing it at
 * once would flash a banner that answers nothing. Long enough to sit out an
 * ordinary reconnect, short enough that a real outage shows up while the user
 * is still looking at the surface that went stale.
 *
 * Home Assistant's client retries on a fixed ladder — immediately, then one
 * second later, then three, then six — so a reconnect does not take an
 * arbitrary amount of time, it lands on a rung. A socket that drops while the
 * network is briefly away misses the first two rungs and comes back on the
 * three-second one, which is an ordinary Wi-Fi roam and must stay silent. This
 * sits between that rung and the six-second one: past six, the network has been
 * gone long enough that the outage is worth saying out loud.
 */
const CONNECTION_LOST_GRACE_MS = 4_500;

/** Attempts (including the first) for a command rejected with `rate_limited`. */
const RATE_LIMIT_ATTEMPTS = 4;

/**
 * Automatic re-subscribes after a `rate_limited` refusal, before the card gives
 * up and waits for the user. Bounded because a limiter tight enough to refuse
 * every attempt will not be talked round by a card that keeps knocking.
 */
const SUBSCRIBE_RETRY_ATTEMPTS = 4;

/**
 * Re-subscribes allowed while the backend reports itself unavailable.
 *
 * Larger than the rate-limited budget because it is spent on a different bet: a
 * config-entry reload refuses for as long as setup takes, and giving up inside
 * that window would leave a card that only ever needed to wait stuck asking for
 * a manual refresh. Still bounded — a disabled or removed integration is not
 * coming back on its own, and the banner has to stop promising otherwise.
 */
const SUBSCRIBE_UNAVAILABLE_ATTEMPTS = 7;

/**
 * Ceiling on a single re-subscribe wait. Also clamps a server-sent retry-after
 * hint, so a wrong or hostile value cannot park live updates indefinitely.
 */
const SUBSCRIBE_RETRY_MAX_MS = 30_000;

/** Topics `subscribeTopics` opens as one round: items, stats, locations, statuses. */
const SUBSCRIBE_TOPIC_COUNT = 4;

/**
 * Re-opens allowed after Home Assistant refuses the area-registry watch.
 *
 * Smaller than the topic budgets and spent quietly, because the two failures are
 * not the same size: a refused topic subscription stops live updates and raises a
 * banner, while this one costs freshness only — the card falls back to the areas
 * it fetched at boot. Without any retry, though, a single refusal freezes area
 * names for the life of the element, so the transient cases (a limiter, a
 * connection reopening mid-subscribe) get a few backoffs before the card settles
 * for the snapshot it has.
 */
const AREA_REGISTRY_RETRY_ATTEMPTS = 3;

/** Event action the backend sends every open subscription as its entry tears down. */
const BACKEND_UNAVAILABLE_ACTION = 'unavailable';

/**
 * Removed item ids kept for `wasRemoved`.
 *
 * Only a host holding an open editor asks, and it asks about one id, so the
 * memory has to outlive a bulk delete of the surrounding rows and nothing more.
 */
const REMOVED_ID_MEMORY = 200;

const NO_DEGRADATION: DegradedState = {
  rateLimited: false,
  connectionLost: false,
  retrying: 0,
  nextRetryAt: null,
  reloading: false,
  liveUpdates: 'live',
  liveUpdatesReason: null,
  nextLiveRetryAt: null,
};

/**
 * The code a failure travelled home with.
 *
 * A string code means a server answered — the backend's taxonomy, or one of
 * Home Assistant's own refusals. Anything else (a numeric transport code, a
 * thrown `Error`, nothing at all) never reached one.
 */
function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && code ? code : TRANSPORT_ERROR_CODE;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * A retry-after hint in milliseconds, or null when the envelope carries none.
 *
 * The error taxonomy defines no retry-after field, so this is read defensively:
 * from `data` (where the contract puts structured context), from `context` (the
 * name the card's own error entries use) and from the top level, accepting
 * either milliseconds or the HTTP convention of seconds. A backend that starts
 * sending one is honoured without a contract change; until then the caller
 * falls back to its own backoff.
 */
function retryAfterHintMs(err: unknown): number | null {
  const envelope = err as { data?: unknown; context?: unknown } | undefined;
  for (const source of [envelope, envelope?.data, envelope?.context]) {
    if (!source || typeof source !== 'object') continue;
    const bag = source as Record<string, unknown>;
    const ms = nonNegativeNumber(bag.retry_after_ms);
    if (ms !== null) return ms;
    const seconds = nonNegativeNumber(bag.retry_after);
    if (seconds !== null) return seconds * 1000;
  }
  return null;
}

/**
 * How long to wait before re-opening a refused subscription: the server's hint
 * when it sends one, otherwise exponential backoff off the card's base delay.
 */
export function subscribeRetryDelayMs(err: unknown, attempt: number, baseMs: number): number {
  const delay = retryAfterHintMs(err) ?? baseMs * 2 ** attempt;
  return Math.min(delay, SUBSCRIBE_RETRY_MAX_MS);
}

/**
 * Translate the card's filter state into the backend's `ItemFilter`.
 *
 * Exported because the staged mobile filter sheet needs to price a filter it has
 * not applied yet (`Store.countMatching`), and "Export current view" needs to
 * send the same object the list is showing.
 */
export function toWireFilter(filters: StoreFilters): ItemFilter {
  const filter: ItemFilter = {
    q: filters.q || undefined,
    area_id: filters.areaId || undefined,
    location_id: filters.locationId ?? undefined,
    // Sent explicitly: the list filter defaults it to false server-side while
    // subscriptions default it to true.
    include_subtree: filters.includeSubtree,
    checked_out: filters.checkedOutOnly || undefined,
    low_stock_only: filters.lowStockOnly || undefined,
    // A presentation hint rather than a filter — it re-sorts, it does not exclude.
    low_stock_first: filters.lowStockFirst || undefined,
    orphaned_only: filters.orphansOnly || undefined,
    overdue_only: filters.overdueOnly || undefined,
    inspection_overdue_only: filters.inspectionDueOnly || undefined,
    status: filters.status ?? undefined,
    category: filters.category || undefined,
    updated_after: filters.updatedAfter || undefined,
    created_after: filters.createdAfter || undefined,
    updated_before: filters.updatedBefore || undefined,
    created_before: filters.createdBefore || undefined,
  };
  if (filters.tags.length) {
    if (filters.tagsMode === 'all') filter.tags_all = [...filters.tags];
    else filter.tags_any = [...filters.tags];
  }
  return filter;
}

/** The filter state a freshly-mounted card starts from. */
export function defaultFilters(): StoreFilters {
  return {
    q: '',
    areaId: null,
    locationId: null,
    includeSubtree: true,
    checkedOutOnly: false,
    lowStockFirst: false,
    orphansOnly: false,
    lowStockOnly: false,
    overdueOnly: false,
    inspectionDueOnly: false,
    status: null,
    category: null,
    tags: [],
    tagsMode: 'any',
    updatedAfter: null,
    createdAfter: null,
    updatedBefore: null,
    createdBefore: null,
    sort: DEFAULT_SORT,
  };
}

/** How many filters (ignoring sort) are narrowing the list right now. */
export function activeFilterCount(filters: StoreFilters): number {
  let n = 0;
  if (filters.q) n += 1;
  if (filters.areaId) n += 1;
  if (filters.locationId) n += 1;
  if (filters.checkedOutOnly) n += 1;
  if (filters.orphansOnly) n += 1;
  if (filters.lowStockOnly) n += 1;
  if (filters.lowStockFirst) n += 1;
  if (filters.overdueOnly) n += 1;
  if (filters.inspectionDueOnly) n += 1;
  if (filters.status) n += 1;
  if (filters.category) n += 1;
  if (filters.tags.length) n += 1;
  if (filters.updatedAfter) n += 1;
  if (filters.createdAfter) n += 1;
  if (filters.updatedBefore) n += 1;
  if (filters.createdBefore) n += 1;
  return n;
}

/** Minimal reactive container: `set` merges a patch and notifies every `onChange` subscriber. */
export interface Observable<T> {
  readonly value: T;
  onChange(cb: () => void): () => void;
}

export function createObservable<T extends object>(initial: T): Observable<T> & { set(patch: Partial<T>): void } {
  let listeners = new Set<() => void>();
  let state = { ...initial } as T;
  const notify = () => listeners.forEach((l) => l());
  return {
    get value() {
      return state;
    },
    set(patch: Partial<T>) {
      Object.assign(state as unknown as Record<string, unknown>, patch as Record<string, unknown>);
      notify();
    },
    onChange(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export interface StoreOptions {
  /** Base backoff for `rate_limited` retries; set to 0 in tests. */
  retryBaseMs?: number;
}

export class Store {
  private ws: WSClient;
  private stateObs: ReturnType<typeof createObservable<StoreState>>;
  private inflight: Map<string, Promise<unknown>> = new Map();
  /** Ids removed since this store connected — see `noteRemoved`. */
  private readonly removedIds = new Set<string>();
  /** The same ids in removal order, so the oldest can be evicted. */
  private readonly removedOrder: string[] = [];
  private itemsUnsub: Unsubscribe | null = null;
  private statsUnsub: Unsubscribe | null = null;
  private locationsUnsub: Unsubscribe | null = null;
  private statusesUnsub: Unsubscribe | null = null;
  private areaRegistryUnsub: Unsubscribe | null = null;
  private retryBaseMs: number;
  private consecutiveTransportFailures = 0;
  private treeRefreshHandle: ReturnType<typeof setTimeout> | null = null;
  private areasRefreshHandle: ReturnType<typeof setTimeout> | null = null;
  /** Identifies the newest subscribe round, so a superseded one stops reporting. */
  private subscribeRound = 0;
  /** Subscribes in the current round that have not resolved or been refused yet. */
  private subscribePending = 0;
  /** First refusal seen in the current round, if any. */
  private subscribeRefusal: { err: unknown } | null = null;
  /** Automatic re-subscribes already spent on the current outage. */
  private subscribeAttempt = 0;
  private subscribeRetryHandle: ReturnType<typeof setTimeout> | null = null;
  /** Re-opens of the area-registry watch already spent on the current refusal. */
  private areaRegistryAttempt = 0;
  private areaRegistryRetryHandle: ReturnType<typeof setTimeout> | null = null;
  /** Identifies the newest area-registry watch, so a superseded one stops reporting. */
  private areaRegistryGeneration = 0;
  /** Detaches the connection-lifecycle listeners; null while none is attached. */
  private connectionReadyUnsub: Unsubscribe | null = null;
  private connectionLostUnsub: Unsubscribe | null = null;
  /** Counts down the grace period on a closed socket; null while it is open. */
  private connectionLostHandle: ReturnType<typeof setTimeout> | null = null;
  /** Last untouched `distinct_values` result, so drafts can be re-merged. */
  private serverDistinct: DistinctValues | null = null;
  /** Values named in the organize dialog that no item carries yet. */
  private drafts: { categories: string[]; tags: string[] } = { categories: [], tags: [] };

  constructor(hass: HassLike, options: StoreOptions = {}) {
    this.ws = new WSClient(hass);
    this.retryBaseMs = options.retryBaseMs ?? 400;

    const initial: StoreState = {
      items: [],
      cursor: null,
      total: null,
      loading: true,
      filters: defaultFilters(),
      selection: new Set<string>(),
      pendingOps: new Map(),
      errorQueue: [],
      areasCache: null,
      locationTreeCache: null,
      locationMatchTotal: null,
      locationsFlatCache: null,
      statsCounts: null,
      healthCache: null,
      versionInfo: null,
      cardTitle: null,
      quickFilters: null,
      mediaConfig: null,
      statuses: null,
      distinctValuesCache: null,
      connected: { items: false, stats: false },
      degraded: { ...NO_DEGRADATION },
    };
    this.stateObs = createObservable<StoreState>(initial);
  }

  get state(): Observable<StoreState> {
    return this.stateObs;
  }

  // ---------- Initialization and subscriptions ----------
  /**
   * Load everything, then start watching for the ways it can go stale.
   *
   * The watches are wired in a `finally` because a card is not always built
   * against a backend that can answer. Home Assistant rebuilds the Lovelace
   * view when its socket reconnects, and it does so before a restarting
   * instance has finished setting the integration up — so the first load of
   * that fresh card is refused, wholesale. Wiring the watches only on the happy
   * path left such a card with no subscriptions, no connection listeners and
   * nothing but the loading skeleton, permanently: every route back into the
   * data is opened here, so failing to reach them is failing for good. Opened
   * anyway, the refused subscribe retries on its own backoff and re-reads the
   * inventory once it lands, which is the same path a disabled config entry
   * already recovers through.
   */
  async init() {
    try {
      await Promise.all([
        this.refreshStats(),
        this.refreshHealth(),
        this.refreshAreas(),
        this.refreshLocationTree(),
        this.refreshLocationsFlat(),
        this.refreshDistinctValues(),
        this.refreshVersion(),
        this.refreshConfig(),
      ]);
      await this.listItems(true);
    } finally {
      this.subscribeTopics();
      this.watchAreaRegistry();
      this.watchConnectionGaps();
    }
  }

  /**
   * Follow the socket itself, in both directions.
   *
   * Coming back is the gap the registry watch cannot see: Home Assistant
   * re-issues the subscriptions it held before it reports `ready`, so the
   * subscribe neither fails nor re-opens and `watchAreaRegistry`'s catch-up
   * never runs — yet an area renamed while the socket was down fired its event
   * into a closed connection. Only a refetch closes that.
   *
   * Going down is what a surface nobody is touching has no other way to learn.
   * Every other outage signal the card has comes from a call it made, so a list
   * left open across a restart would go on showing pre-outage data, silently,
   * until someone tried something.
   */
  private watchConnectionGaps() {
    this.connectionReadyUnsub?.();
    this.connectionLostUnsub?.();
    this.connectionReadyUnsub = this.ws.onConnectionReady(() => {
      this.cancelConnectionLostGrace();
      this.noteSuccess();
      this.scheduleAreasRefresh();
    });
    this.connectionLostUnsub = this.ws.onConnectionLost(() => this.startConnectionLostGrace());
  }

  /** Declare the connection lost unless it comes back inside the grace period. */
  private startConnectionLostGrace() {
    if (this.connectionLostHandle !== null) return;
    this.connectionLostHandle = setTimeout(() => {
      this.connectionLostHandle = null;
      this.setDegraded({ connectionLost: true });
    }, CONNECTION_LOST_GRACE_MS);
  }

  private cancelConnectionLostGrace() {
    if (this.connectionLostHandle === null) return;
    clearTimeout(this.connectionLostHandle);
    this.connectionLostHandle = null;
  }

  /**
   * Keep the area cache honest for as long as the card is mounted.
   *
   * The store is built once per element and a dashboard stays open for days, so
   * a one-shot fetch would name areas by whatever the registry said at boot —
   * every path the card prints carries an area, so a rename would go stale
   * everywhere at once, and a deletion would show a raw id. Areas move rarely
   * and the list is small, so the event only triggers a refetch.
   */
  private watchAreaRegistry(resetRetryBudget = true) {
    this.cancelAreaRegistryRetry();
    if (resetRetryBudget) this.areaRegistryAttempt = 0;
    // A re-open spans a window in which the registry could have moved with
    // nothing listening to say so, so the cache is re-read on the way back. The
    // first open needs no catch-up: `init` fetched the areas moments ago.
    const catchUp = this.areaRegistryAttempt > 0;
    // A refusal can arrive after this watch has been replaced or the store
    // disposed, and HA's own subscribe carries no cancellation of its own.
    const generation = ++this.areaRegistryGeneration;
    if (this.areaRegistryUnsub) this.areaRegistryUnsub();
    this.areaRegistryUnsub = this.ws.subscribeAreaRegistry(() => this.scheduleAreasRefresh(), {
      onOpen: () => {
        if (catchUp && generation === this.areaRegistryGeneration) this.scheduleAreasRefresh();
      },
      onError: (err) => {
        if (generation === this.areaRegistryGeneration) this.onAreaRegistryRefused(err);
      },
    });
  }

  /**
   * Home Assistant refused the registry watch — back off and try again, quietly.
   *
   * Nothing is reported to the user: the fallback is the area list the card
   * already holds, so a banner would name a degradation nobody can act on, and
   * the topic subscriptions' `degraded` state means live *inventory* updates are
   * gone, which is not what happened here. Once the budget is spent the card
   * keeps its boot-time snapshot, which is what it did before it listened.
   */
  private onAreaRegistryRefused(err: unknown) {
    if (this.areaRegistryAttempt >= AREA_REGISTRY_RETRY_ATTEMPTS) return;
    const delay = subscribeRetryDelayMs(err, this.areaRegistryAttempt, this.retryBaseMs);
    this.areaRegistryAttempt += 1;
    this.cancelAreaRegistryRetry();
    this.areaRegistryRetryHandle = setTimeout(() => {
      this.areaRegistryRetryHandle = null;
      this.watchAreaRegistry(false);
    }, delay);
  }

  private cancelAreaRegistryRetry() {
    if (this.areaRegistryRetryHandle === null) return;
    clearTimeout(this.areaRegistryRetryHandle);
    this.areaRegistryRetryHandle = null;
  }

  /** Coalesce area refetches: editing a handful of areas fires one event each. */
  private scheduleAreasRefresh(delayMs = 250) {
    if (this.areasRefreshHandle !== null) clearTimeout(this.areasRefreshHandle);
    this.areasRefreshHandle = setTimeout(() => {
      this.areasRefreshHandle = null;
      void this.refreshAreas().catch(() => undefined);
    }, delayMs);
  }

  /** (Re)open the topic subscriptions, starting the retry budget over. */
  subscribeTopics() {
    this.openSubscriptions(true);
  }

  /**
   * Open the four topic subscriptions as one round.
   *
   * The round, not the individual topic, is the unit of health: the rate limiter
   * bills each subscribe separately, so it can let `items` through and refuse
   * `stats` a moment later. Live updates only count as restored once every
   * subscribe in the newest round has been accepted.
   */
  private openSubscriptions(resetRetryBudget: boolean) {
    this.cancelSubscribeRetry();
    if (resetRetryBudget) this.subscribeAttempt = 0;
    const round = ++this.subscribeRound;
    this.subscribePending = SUBSCRIBE_TOPIC_COUNT;
    this.subscribeRefusal = null;
    const onOpen = () => this.onSubscribeSettled(round, null);
    const onError = (err: unknown) => this.onSubscribeSettled(round, { err });
    // The backend's teardown signal arrives on whichever topics are open, and
    // says the same thing on each — handle it once, ahead of the topic handlers,
    // which only know how to fold an inventory payload into the view.
    const onEvent = (handle: (evt: AnyEventPayload) => void) => (evt: AnyEventPayload) => {
      if (evt.action === BACKEND_UNAVAILABLE_ACTION) this.onBackendUnavailable();
      else handle(evt);
    };

    if (this.itemsUnsub) this.itemsUnsub();
    this.itemsUnsub = this.ws.subscribe('items', onEvent((evt) => this.onItemsEvent(evt)), {
      location_id: this.state.value.filters.locationId ?? undefined,
      area_id: this.state.value.filters.areaId ?? undefined,
      include_subtree: true, // Always include sublocations
      onError,
      onOpen,
    });
    if (this.statsUnsub) this.statsUnsub();
    this.statsUnsub = this.ws.subscribe('stats', onEvent((evt) => this.onStatsEvent(evt)), {
      onError,
      onOpen,
    });
    if (this.locationsUnsub) this.locationsUnsub();
    this.locationsUnsub = this.ws.subscribe(
      'locations',
      onEvent((evt) => this.onLocationsEvent(evt)),
      { onError, onOpen },
    );
    if (this.statusesUnsub) this.statusesUnsub();
    // The vocabulary is small and changes rarely, so any event on the topic
    // re-reads the whole list rather than applying a per-action patch. It also
    // keeps a card correct when another client reorders, which no single
    // event payload describes better than the list itself does.
    this.statusesUnsub = this.ws.subscribe('statuses', onEvent(() => void this.refreshStatuses()), {
      onError,
      onOpen,
    });
  }

  /**
   * The config entry serving these subscriptions is tearing down.
   *
   * A reload is the common case and it ends by itself, so the card waits it out
   * on the same backoff a refused subscribe uses rather than reporting an error
   * for something that will be over in a moment. The first attempt is scheduled
   * rather than immediate: the backend is mid-teardown and would certainly
   * refuse. Disabled and removed look identical from here, and end as the
   * budget running out.
   */
  private onBackendUnavailable() {
    if (this.state.value.degraded.liveUpdatesReason === 'unavailable') return;
    this.stateObs.set({ connected: { items: false, stats: false } });
    this.subscribeAttempt = 0;
    this.scheduleReopen('unavailable', null);
  }

  /** Fold one subscribe outcome into its round, and act once the round is complete. */
  private onSubscribeSettled(round: number, refusal: { err: unknown } | null) {
    if (round !== this.subscribeRound) return; // a newer round has taken over
    if (refusal && !this.subscribeRefusal) this.subscribeRefusal = refusal;
    if (this.subscribePending > 0) this.subscribePending -= 1;
    if (this.subscribePending > 0) return;

    const refused = this.subscribeRefusal;
    if (!refused) {
      const wasUnavailable = this.state.value.degraded.liveUpdatesReason === 'unavailable';
      this.subscribeAttempt = 0;
      this.stateObs.set({ connected: { items: true, stats: true } });
      this.setDegraded({ liveUpdates: 'live', liveUpdatesReason: null, nextLiveRetryAt: null });
      // A backend that went away and came back was reading its store afresh, and
      // every event in between was addressed to subscriptions that no longer
      // existed. Nothing on screen is trustworthy until it has been re-read.
      if (wasUnavailable) void this.reloadAll().catch(() => undefined);
      return;
    }
    this.onSubscribeRefused(refused.err);
  }

  /**
   * A refused subscribe means live updates are gone, silently — no event will
   * ever arrive to hint at it.
   *
   * Three refusals are worth waiting out. `rate_limited` is the expected one and
   * the contract's guidance is to retry later; `storage_error` is what a backend
   * with no config entry answers, which a reload clears on its own; and
   * `unknown_command` is Home Assistant's own answer for a command type nobody
   * has registered, which for `haventory/subscribe` means the integration has
   * not been set up yet. A restarting instance serves the frontend — and the
   * Lovelace view it rebuilds on reconnect — before it gets that far, so a card
   * refused this way is early rather than broken. All three back off and say the
   * card is retrying instead of dropping an error on a user who has done nothing
   * wrong. Once the budget is spent it stops, reports the refusal and leaves the
   * manual refresh as the way back. Any other refusal is an outage and is
   * reported at once.
   */
  private onSubscribeRefused(err: unknown) {
    this.stateObs.set({ connected: { items: false, stats: false } });

    const code = errorCode(err);
    const reason: LiveUpdatePause | null =
      code === 'rate_limited'
        ? 'rate_limited'
        : code === 'storage_error' || code === 'unknown_command'
          ? 'unavailable'
          : null;
    if (reason === null) {
      this.setDegraded({
        connectionLost: true,
        liveUpdates: 'paused',
        liveUpdatesReason: null,
        nextLiveRetryAt: null,
      });
      this.pushError(err);
      return;
    }

    // Sticky, and set here rather than alongside the pause: it says events may
    // have been dropped, which stays true for the rest of the session however
    // the subscriptions end up.
    if (reason === 'rate_limited') this.setDegraded({ rateLimited: true });

    const budget =
      reason === 'unavailable' ? SUBSCRIBE_UNAVAILABLE_ATTEMPTS : SUBSCRIBE_RETRY_ATTEMPTS;
    if (this.subscribeAttempt >= budget) {
      this.setDegraded({ liveUpdates: 'paused', liveUpdatesReason: reason, nextLiveRetryAt: null });
      this.pushError(err);
      return;
    }

    this.scheduleReopen(reason, err);
  }

  /** Book the next re-subscribe and say so, so the banner can show the wait. */
  private scheduleReopen(reason: LiveUpdatePause, err: unknown) {
    const delay = subscribeRetryDelayMs(err, this.subscribeAttempt, this.retryBaseMs);
    this.subscribeAttempt += 1;
    this.setDegraded({
      liveUpdates: 'retrying',
      liveUpdatesReason: reason,
      nextLiveRetryAt: Date.now() + delay,
    });
    this.cancelSubscribeRetry();
    this.subscribeRetryHandle = setTimeout(() => {
      this.subscribeRetryHandle = null;
      this.openSubscriptions(false);
    }, delay);
  }

  private cancelSubscribeRetry() {
    if (this.subscribeRetryHandle === null) return;
    clearTimeout(this.subscribeRetryHandle);
    this.subscribeRetryHandle = null;
  }

  /** Tear down the four subscriptions and any pending tree refresh. */
  dispose() {
    this.itemsUnsub?.();
    this.statsUnsub?.();
    this.locationsUnsub?.();
    this.statusesUnsub?.();
    this.areaRegistryUnsub?.();
    // Held by Home Assistant's connection, which outlives every card on the
    // dashboard — a listener left behind would refetch for a disposed store on
    // every reconnect, for as long as the page is open.
    this.connectionReadyUnsub?.();
    this.connectionLostUnsub?.();
    this.cancelConnectionLostGrace();
    this.itemsUnsub = this.statsUnsub = this.locationsUnsub = this.statusesUnsub = null;
    this.areaRegistryUnsub = null;
    this.connectionReadyUnsub = null;
    this.connectionLostUnsub = null;
    // Nothing is listening after this, so a queued re-subscribe must not fire.
    this.subscribeRound += 1;
    this.areaRegistryGeneration += 1;
    this.cancelSubscribeRetry();
    this.cancelAreaRegistryRetry();
    if (this.treeRefreshHandle !== null) {
      clearTimeout(this.treeRefreshHandle);
      this.treeRefreshHandle = null;
    }
    if (this.areasRefreshHandle !== null) {
      clearTimeout(this.areasRefreshHandle);
      this.areasRefreshHandle = null;
    }
    this.stateObs.set({ connected: { items: false, stats: false } });
  }

  private onItemsEvent(evt: AnyEventPayload) {
    if (evt.topic !== 'items') return;
    const item = (evt as ItemsEventPayload).item;
    if (evt.action === 'reloaded' || item === undefined) {
      // The dataset moved wholesale and the signal carries no item to merge:
      // an import replaced everything, or a status was deleted and every item
      // carrying it reassigned in one call. Either way a merge is impossible —
      // refetch, and say so while it is in flight, because anything the user
      // has open may be editing data that no longer exists.
      this.setDegraded({ reloading: true });
      void this.listItems(true)
        .catch(() => undefined)
        .finally(() => this.setDegraded({ reloading: false }));
      void this.refreshDistinctValues().catch(() => undefined);
      this.scheduleTreeRefresh();
      return;
    }
    const items = this.state.value.items.slice();
    const idx = items.findIndex((x) => x.id === item.id);
    switch (evt.action) {
      case 'created':
      case 'updated':
      case 'moved':
      case 'checked_out':
      case 'checked_in':
      case 'quantity_changed': {
        if (idx >= 0) items[idx] = item; else items.unshift(item);
        this.forgetRemoved(item.id);
        break;
      }
      case 'deleted': {
        if (idx >= 0) items.splice(idx, 1);
        this.noteRemoved(item.id);
        break;
      }
    }
    this.stateObs.set({ items });
    // Category/tag distributions can change on create/update/delete — keep the
    // autocomplete source fresh. Other actions (quantity, check-out) can't.
    if (evt.action === 'created' || evt.action === 'updated' || evt.action === 'deleted') {
      void this.refreshDistinctValues().catch(() => undefined);
    }
    // Per-location counts live on the tree, and only `stats/counts` is pushed —
    // so anything that moves an item between locations needs a tree refetch.
    if (evt.action === 'created' || evt.action === 'deleted' || evt.action === 'moved') {
      this.scheduleTreeRefresh();
    }
  }

  /**
   * Coalesce tree refetches. `location/tree` is a full walk with no parameters,
   * so a burst of item events (a bulk move, an import) must not fire one per event.
   */
  private scheduleTreeRefresh(delayMs = 250) {
    if (this.treeRefreshHandle !== null) clearTimeout(this.treeRefreshHandle);
    this.treeRefreshHandle = setTimeout(() => {
      this.treeRefreshHandle = null;
      void this.refreshLocationTree().catch(() => undefined);
    }, delayMs);
  }

  private onStatsEvent(evt: AnyEventPayload) {
    if (evt.topic !== 'stats' || evt.action !== 'counts') return;
    this.stateObs.set({ statsCounts: (evt as unknown as { counts: StatsCounts }).counts });
  }

  private onLocationsEvent(evt: AnyEventPayload) {
    if (evt.topic !== 'locations') return;
    if (evt.action === 'reloaded') {
      void Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
      void this.listItems(true);
      return;
    }
    void Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
    // Moving or renaming a location rewrites the denormalized location_path on
    // every item in its subtree — reload the list so rows reflect it live.
    if (evt.action === 'moved' || evt.action === 'renamed') {
      void this.listItems(true);
    }
  }

  // ---------- Data fetchers ----------
  // Reads go through `run` too: a rate-limited read deserves the same backoff,
  // and a run of transport failures on any call is what "connection lost" means.
  async refreshStats() {
    const counts = await this.run(() => this.ws.stats());
    this.stateObs.set({ statsCounts: counts });
  }

  async refreshHealth() {
    const health: HealthResult = await this.run(() => this.ws.health());
    this.stateObs.set({ healthCache: health });
  }

  async refreshAreas() {
    const areas = await this.run(() => this.ws.listAreas());
    this.stateObs.set({ areasCache: areas as AreasListResult });
  }

  /** Refresh distinct categories/tags with counts (source for autocomplete). */
  async refreshDistinctValues() {
    const distinct = (await this.run(() => this.ws.distinctValues())) as DistinctValues;
    this.serverDistinct = distinct;
    // A draft the backend now knows about is no longer a draft.
    const known = (list: DistinctValue[], value: string) =>
      list.some((v) => v.value.toLowerCase() === value.toLowerCase());
    this.drafts = {
      categories: this.drafts.categories.filter((v) => !known(distinct.categories, v)),
      tags: this.drafts.tags.filter((v) => !known(distinct.tags, v)),
    };
    this.publishDistinct();
  }

  /**
   * Name a category or tag before any item carries it.
   *
   * There is nothing to create server-side — `distinct_values` is derived from
   * the items — so the value is held here at count 0 and offered as a
   * suggestion until an item adopts it, at which point the refresh above drops
   * the draft in favour of the real one. Returns false for a blank name or one
   * that already exists.
   */
  addDraftValue(kind: 'category' | 'tag', raw: string): boolean {
    const value = kind === 'tag' ? raw.trim().toLowerCase() : raw.trim();
    if (!value) return false;
    const key = kind === 'tag' ? 'tags' : 'categories';
    const current = this.state.value.distinctValuesCache?.[key] ?? [];
    if (current.some((v) => v.value.toLowerCase() === value.toLowerCase())) return false;
    this.drafts = { ...this.drafts, [key]: [...this.drafts[key], value] };
    this.publishDistinct();
    return true;
  }

  /** Drop a value named here that never made it onto an item. */
  removeDraftValue(kind: 'category' | 'tag', value: string): void {
    const key = kind === 'tag' ? 'tags' : 'categories';
    this.drafts = {
      ...this.drafts,
      [key]: this.drafts[key].filter((v) => v.toLowerCase() !== value.toLowerCase()),
    };
    this.publishDistinct();
  }

  /** True while this value only exists on the card. */
  isDraftValue(kind: 'category' | 'tag', value: string): boolean {
    const key = kind === 'tag' ? 'tags' : 'categories';
    return this.drafts[key].some((v) => v.toLowerCase() === value.toLowerCase());
  }

  /** Publish the server's distinct values with the drafts folded in. */
  private publishDistinct() {
    const server = this.serverDistinct;
    if (!server) return;
    const merge = (list: DistinctValue[], drafts: string[]): DistinctValue[] =>
      drafts.length
        ? [...list, ...drafts.map((value) => ({ value, count: 0 }))].sort((a, b) =>
            a.value.toLowerCase().localeCompare(b.value.toLowerCase()),
          )
        : list;
    this.stateObs.set({
      distinctValuesCache: {
        ...server,
        categories: merge(server.categories, this.drafts.categories),
        tags: merge(server.tags, this.drafts.tags),
      },
    });
  }

  /** Version banner for the diagnostics panel. */
  async refreshVersion() {
    const info = await this.run(() => this.ws.version());
    this.stateObs.set({ versionInfo: info });
  }

  /** Re-read the status vocabulary after another client changed it. */
  async refreshStatuses() {
    const statuses = await this.run(() => this.ws.listStatuses()).catch(() => null);
    if (statuses) this.stateObs.set({ statuses });
  }

  /**
   * What the integration decided: card heading, quick-filter pills, the status
   * vocabulary, the attachment caps.
   *
   * All of it cosmetic, so a backend that does not answer the command — an
   * integration older than this bundle — leaves every one of them at its
   * built-in default instead of failing the whole init.
   */
  async refreshConfig() {
    const config = await this.run(() => this.ws.config()).catch(() => null);
    const title = config?.card_title;
    if (typeof title === 'string' && title) this.stateObs.set({ cardTitle: title });
    // `undefined` is a backend too old to answer and leaves the state alone;
    // `null` is one that answered "no opinion". Both read as every pill, but
    // only the second is a report, and an explicit `[]` is a third answer the
    // normalizer keeps whole.
    if (config && 'quick_filters' in config) {
      this.stateObs.set({ quickFilters: normalizeQuickFilters(config.quick_filters) });
    }
    if (config?.media) this.stateObs.set({ mediaConfig: config.media });
    if (config?.statuses?.length) this.stateObs.set({ statuses: config.statuses });
  }

  // ---------- Attachments ----------

  /**
   * Upload one file and attach it to an item.
   *
   * Its own action rather than part of the item save: an 8 MB POST inside a
   * form submit makes the save look hung. Errors are thrown rather than pushed
   * onto the error queue — the picker shows them per file, next to the file
   * that failed, which a global banner cannot do.
   */
  async uploadAttachment(
    itemId: string,
    file: File,
    kind: AttachmentKind = 'picture',
    expectedVersion?: number,
  ): Promise<Item> {
    const updated = await this.ws.uploadAttachment(itemId, file, kind, expectedVersion);
    this.applyOptimistic(updated);
    return updated;
  }

  /** Rename one attachment for display, leaving its filename and bytes alone. */
  async updateAttachment(
    itemId: string,
    attachmentId: string,
    title: string,
    expectedVersion?: number,
  ): Promise<Item> {
    const updated = await this.ws.updateAttachment(itemId, attachmentId, title, expectedVersion);
    this.applyOptimistic(updated);
    return updated;
  }

  /** Renumber one kind's attachments; the first id named becomes position 0. */
  async reorderAttachments(
    itemId: string,
    kind: AttachmentKind,
    attachmentIds: string[],
    expectedVersion?: number,
  ): Promise<Item> {
    const updated = await this.ws.reorderAttachments(
      itemId,
      kind,
      attachmentIds,
      expectedVersion,
    );
    this.applyOptimistic(updated);
    return updated;
  }

  /** Detach one file; the backend deletes the bytes with it. */
  async removeAttachment(
    itemId: string,
    attachmentId: string,
    expectedVersion?: number,
  ): Promise<Item> {
    const updated = await this.ws.removeAttachment(itemId, attachmentId, expectedVersion);
    this.applyOptimistic(updated);
    return updated;
  }

  /** Sign one attachment's media path so an `<img>` can load it. */
  signMediaPath(path: string, expires: number): Promise<string> {
    return this.ws.signPath(path, expires);
  }

  /**
   * The filter the per-location counts are measured against.
   *
   * Everything the user has narrowed by *except* location: the tree is how you
   * choose a location, so applying the current choice to it would zero every
   * other branch exactly when you want to see where else the matches are.
   */
  private locationCountFilters(): StoreFilters {
    return {
      ...this.state.value.filters,
      locationId: null,
      includeSubtree: true,
      orphansOnly: false,
    };
  }

  async refreshLocationTree() {
    const counting = this.locationCountFilters();
    const filtered = activeFilterCount(counting) > 0;
    const tree = await this.run(() => this.ws.getLocationTree(filtered ? toWireFilter(counting) : undefined));
    // Sorted once here so every consumer — sidebar, pickers, organize dialog —
    // sees the same order; the API returns nodes in insertion order.
    this.stateObs.set({ locationTreeCache: sortLocationTree((tree ?? []) as LocationTreeNode[]) });
    // The tree covers filed items only, so the whole-inventory match count comes
    // separately; "No location" is then the remainder, with no third query.
    this.stateObs.set({ locationMatchTotal: filtered ? await this.countMatching(counting) : null });
  }

  async refreshLocationsFlat() {
    const locs = await this.run(() => this.ws.listLocations());
    const list = (locs as Location[]).slice().sort((a, b) =>
      (a.path?.sort_key || '').localeCompare(b.path?.sort_key || '', undefined, { sensitivity: 'base' }),
    );
    this.stateObs.set({ locationsFlatCache: list });
  }

  // ---------- Listing & pagination ----------
  async listItems(reset = false) {
    const st = this.state.value;
    const filter = toWireFilter(st.filters);
    const sort = st.filters.sort;
    const limit = PAGE_LIMIT;
    const cursor = reset ? undefined : st.cursor || undefined;

    const key = JSON.stringify({ op: 'list', filter, sort, limit, cursor });
    if (this.inflight.has(key)) return this.inflight.get(key) as Promise<void>;

    const p = this.ws
      .listItems(filter, sort, limit, cursor)
      .then((res: ListItemsResult) => {
        this.noteSuccess();
        const merged = reset ? res.items : mergeUniqueById(this.state.value.items, res.items);
        this.stateObs.set({
          items: merged,
          cursor: res.next_cursor,
          // `total` counts every match across all pages, not just this one.
          total: typeof res.total === 'number' ? res.total : null,
          loading: false,
        });
      })
      .catch((err: unknown) => {
        this.noteFailure(err);
        this.stateObs.set({ loading: false });
        this.pushError(err);
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, p);
    return p as Promise<void>;
  }

  /**
   * How many items a filter would match, without applying it.
   *
   * The staged mobile filter sheet shows a live "Show 38 items" before the user
   * commits, and there is no count-only endpoint — so ask for one row and read
   * the filtered `total` off the response.
   */
  async countMatching(filters: StoreFilters): Promise<number | null> {
    try {
      const res = await this.ws.listItems(toWireFilter(filters), filters.sort, 1);
      return typeof res.total === 'number' ? res.total : null;
    } catch {
      return null;
    }
  }

  /**
   * Every item matching a filter, in one shot. Omitting `limit` makes the backend
   * return the whole match set — that is what "Load all N to select" and the
   * tag/category merge rewrites need, since selection cannot span unloaded pages.
   */
  async listAllMatching(filter: ItemFilter): Promise<Item[]> {
    const res = await this.ws.listItems(filter);
    return res.items;
  }

  /** Load every remaining page of the current filter into the list. */
  async loadAllPages(maxPages = 200): Promise<void> {
    let pages = 0;
    while (this.state.value.cursor && pages < maxPages) {
      const before = this.state.value.cursor;
      await this.listItems(false);
      pages += 1;
      if (this.state.value.cursor === before) break; // defensive: cursor not advancing
    }
  }

  async prefetchIfNeeded(scrollRatio: number) {
    if (scrollRatio < 0.7) return;
    if (!this.state.value.cursor) return;
    await this.listItems(false);
  }

  // ---------- Filters ----------
  setFilters(patch: Partial<StoreFilters>) {
    const next = { ...this.state.value.filters, ...patch };
    const scopeChanged =
      next.locationId !== this.state.value.filters.locationId ||
      next.areaId !== this.state.value.filters.areaId;
    // The rows already loaded stay on screen until the refetch lands, marked as
    // loading. Blanking them is what tore the scroller down mid-edit and took an
    // open editor with it; `listItems(true)` replaces the array wholesale anyway,
    // so nothing here has to clear it first.
    this.stateObs.set({
      filters: next,
      cursor: null,
      loading: true,
      // A row that is no longer listed cannot stay selected.
      selection: new Set<string>(),
    });
    // The items subscription is scoped by location and area, so those two are
    // the only filters that need the sockets torn down and rebuilt.
    if (scopeChanged) this.subscribeTopics();
    void this.listItems(true);
    // Per-location counts are measured against the filter, so they move with it.
    // Coalesced: a filter panel can patch several keys in a row. Re-ordering
    // changes no count, and a sortable table header would otherwise walk the
    // whole tree on every click.
    if (Object.keys(patch).some((key) => key !== 'sort')) this.scheduleTreeRefresh();
  }

  /** Drop every filter, keeping the current sort. */
  clearFilters() {
    this.setFilters({ ...defaultFilters(), sort: this.state.value.filters.sort });
  }

  // ---------- Selection (bulk actions) ----------
  private setSelection(next: Set<string>) {
    this.stateObs.set({ selection: next });
  }

  toggleSelected(itemId: string) {
    const next = new Set(this.state.value.selection);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    this.setSelection(next);
  }

  setSelected(itemIds: Iterable<string>) {
    this.setSelection(new Set(itemIds));
  }

  clearSelection() {
    if (this.state.value.selection.size === 0) return;
    this.setSelection(new Set<string>());
  }

  /**
   * Select the rows that are loaded — deliberately not "all matching". Cursor
   * pagination means the card only holds a prefix of the match set, so the UI
   * labels this honestly and offers `loadAllThenSelectAll` as the explicit path.
   */
  selectAllLoaded() {
    this.setSelection(new Set(this.state.value.items.map((i) => i.id)));
  }

  /** Page in every remaining match, then select the lot. */
  async loadAllThenSelectAll(): Promise<void> {
    await this.loadAllPages();
    this.selectAllLoaded();
  }

  // ---------- Degraded / retry plumbing ----------
  private setDegraded(patch: Partial<DegradedState>) {
    const next = { ...this.state.value.degraded, ...patch };
    const cur = this.state.value.degraded;
    const same =
      cur.rateLimited === next.rateLimited &&
      cur.connectionLost === next.connectionLost &&
      cur.retrying === next.retrying &&
      cur.nextRetryAt === next.nextRetryAt &&
      cur.reloading === next.reloading &&
      cur.liveUpdates === next.liveUpdates &&
      cur.liveUpdatesReason === next.liveUpdatesReason &&
      cur.nextLiveRetryAt === next.nextLiveRetryAt;
    if (same) return;
    this.stateObs.set({ degraded: next });
  }

  /** Any successful round trip proves the socket is alive. */
  private noteSuccess() {
    this.consecutiveTransportFailures = 0;
    if (this.state.value.degraded.connectionLost) this.setDegraded({ connectionLost: false });
  }

  /**
   * Classify a failure. A refusal that came back over the socket — including
   * the taxonomy's `unknown_error` catch-all — proves the transport works and
   * says only that the command was rejected. A run of failures that carry no
   * such answer is the second "connection lost" signal, alongside the socket's
   * own `disconnected` event: it catches the outages that close no socket, such
   * as a server that accepts the connection and stops answering on it.
   */
  private noteFailure(err: unknown) {
    const code = errorCode(err);
    if (code === 'rate_limited') {
      this.setDegraded({ rateLimited: true });
      return;
    }
    if (code !== TRANSPORT_ERROR_CODE) {
      this.consecutiveTransportFailures = 0;
      return;
    }
    this.consecutiveTransportFailures += 1;
    if (this.consecutiveTransportFailures >= CONNECTION_LOST_THRESHOLD) {
      this.setDegraded({ connectionLost: true });
    }
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Run a command, retrying with backoff while the backend says `rate_limited`.
   *
   * Rate limiting is opt-in but real, and the contract's guidance is to retry
   * later — so the card absorbs it rather than surfacing a scary error on the
   * first refusal. The banner shows the wait; if every attempt is refused the
   * error propagates and the caller reports it as usual.
   */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const out = await fn();
        this.noteSuccess();
        if (attempt > 0) {
          this.setDegraded({
            retrying: Math.max(0, this.state.value.degraded.retrying - 1),
            nextRetryAt: null,
          });
        }
        return out;
      } catch (err) {
        this.noteFailure(err);
        const retriable = errorCode(err) === 'rate_limited' && attempt < RATE_LIMIT_ATTEMPTS - 1;
        if (!retriable) {
          if (attempt > 0) {
            this.setDegraded({
              retrying: Math.max(0, this.state.value.degraded.retrying - 1),
              nextRetryAt: null,
            });
          }
          throw err;
        }
        const delay = this.retryBaseMs * 2 ** attempt;
        this.setDegraded({
          retrying: attempt === 0 ? this.state.value.degraded.retrying + 1 : this.state.value.degraded.retrying,
          nextRetryAt: Date.now() + delay,
        });
        await this.sleep(delay);
      }
    }
  }

  /**
   * Re-list everything and clear the degraded flags.
   *
   * This is the recovery the contract prescribes: a dropped subscription event
   * is undetectable, so the only honest fix is an explicit, user-triggered
   * re-read of items, locations and stats.
   */
  async refreshAll(): Promise<void> {
    this.consecutiveTransportFailures = 0;
    // The calls below re-answer the question the grace period was waiting on.
    this.cancelConnectionLostGrace();
    this.setDegraded({ ...NO_DEGRADATION });
    await this.reloadAll();
    // Re-establish subscriptions in case one of them was refused earlier.
    this.subscribeTopics();
  }

  // ---------- Optimistic writes ----------
  async createItem(input: ItemCreate) {
    const opId = `create:${Date.now()}`;
    this.state.value.pendingOps.set(opId, { kind: 'create' });
    try {
      const created = await this.run(() => this.ws.createItem(input));
      // Insert optimistically already covered by items event; ensure presence
      const items = mergeUniqueById(this.state.value.items, [created]);
      this.stateObs.set({ items });
    } catch (err) {
      this.pushError(err);
    } finally {
      this.state.value.pendingOps.delete(opId);
      this.stateObs.set({ pendingOps: new Map(this.state.value.pendingOps) });
    }
  }

  async updateItem(itemId: string, changes: ItemUpdate, expectedVersion?: number) {
    const opId = `update:${itemId}:${Date.now()}`;
    this.state.value.pendingOps.set(opId, { kind: 'update', itemId });
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) {
      const optimistic: Item = { ...before, ...changes } as Item;
      this.applyOptimistic(optimistic);
    }
    try {
      const updated = await this.run(() => this.ws.updateItem(itemId, changes, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      // Capture conflict context for actionable retry
      this.pushError(err, { itemId, changes });
      if (before) this.applyOptimistic(before);
    } finally {
      this.state.value.pendingOps.delete(opId);
      this.stateObs.set({ pendingOps: new Map(this.state.value.pendingOps) });
    }
  }

  async deleteItem(itemId: string, expectedVersion?: number) {
    const opId = `delete:${itemId}:${Date.now()}`;
    this.state.value.pendingOps.set(opId, { kind: 'delete', itemId });
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.removeById(itemId);
    try {
      await this.run(() => this.ws.deleteItem(itemId, expectedVersion));
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    } finally {
      this.state.value.pendingOps.delete(opId);
      this.stateObs.set({ pendingOps: new Map(this.state.value.pendingOps) });
    }
  }

  async adjustQuantity(itemId: string, delta: number, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.applyOptimistic({ ...before, quantity: before.quantity + delta } as Item);
    try {
      const updated = await this.run(() => this.ws.adjustQuantity(itemId, delta, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async setQuantity(itemId: string, quantity: number, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.applyOptimistic({ ...before, quantity } as Item);
    try {
      const updated = await this.run(() => this.ws.setQuantity(itemId, quantity, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async checkOut(itemId: string, dueDate?: string | null, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.applyOptimistic({ ...before, checked_out: true, due_date: dueDate ?? before.due_date } as Item);
    try {
      const updated = await this.run(() => this.ws.checkOut(itemId, dueDate, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async markCheckedIn(itemId: string, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.applyOptimistic({ ...before, checked_out: false } as Item);
    try {
      const updated = await this.run(() => this.ws.markCheckedIn(itemId, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async setLowStockThreshold(itemId: string, threshold: number | null, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.applyOptimistic({ ...before, low_stock_threshold: threshold } as Item);
    try {
      const updated = await this.run(() => this.ws.setLowStockThreshold(itemId, threshold, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async moveItem(itemId: string, locationId: string | null, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.applyOptimistic({ ...before, location_id: locationId } as Item);
    try {
      const updated = await this.run(() => this.ws.moveItem(itemId, locationId, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async createLocation(name: string, parentId?: string | null, areaId?: string | null): Promise<Location> {
    const created = await this.ws.createLocation(name, parentId ?? null, areaId ?? undefined);
    await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
    return created;
  }

  async updateLocation(
    locationId: string,
    // `newParentId` re-parents the whole subtree in the same call — the WS
    // command takes it, so an edit that also moves the location is one trip.
    changes: { name?: string; areaId?: string | null; newParentId?: string | null },
  ): Promise<Location> {
    const updated = await this.ws.updateLocation(locationId, changes);
    await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
    return updated;
  }

  /** Delete an empty location. Rejects with validation_error when it still has children or items. */
  async deleteLocation(locationId: string): Promise<void> {
    await this.ws.deleteLocation(locationId);
    await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
  }

  /** Move a whole subtree under a new parent (null = top level). Descendant paths update live. */
  async moveLocationSubtree(locationId: string, newParentId: string | null): Promise<Location> {
    const moved = await this.ws.moveLocationSubtree(locationId, newParentId);
    await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
    // Denormalized item location_path values changed for the whole subtree.
    await this.listItems(true);
    return moved;
  }

  // ---------- Status definitions ----------

  async createStatus(status: {
    slug: string;
    label: string;
    color?: StatusColor;
    icon?: string;
  }): Promise<StatusDefinition> {
    const created = await this.ws.createStatus(status);
    await this.refreshStatuses();
    return created;
  }

  /** Edit presentation. No item moves, so nothing but the vocabulary refreshes. */
  async updateStatus(
    slug: string,
    changes: { label?: string; color?: StatusColor; icon?: string },
  ): Promise<StatusDefinition> {
    const updated = await this.ws.updateStatus(slug, changes);
    await this.refreshStatuses();
    return updated;
  }

  async reorderStatuses(slugs: string[]): Promise<StatusDefinition[]> {
    const ordered = await this.ws.reorderStatuses(slugs);
    await this.refreshStatuses();
    return ordered;
  }

  /**
   * Delete a status, moving the items that carry it when a target is given.
   *
   * Rejects with `validation_error` when items still reference the slug and no
   * target was chosen — the backend refuses rather than orphaning them.
   *
   * A reassignment rewrote items, so the item list and the counts are re-read
   * too. The `statuses` subscription would deliver that eventually, but every
   * other mutator here refreshes what it changed rather than waiting on its own
   * broadcast.
   */
  async deleteStatus(slug: string, reassignTo?: string): Promise<number> {
    const { reassigned } = await this.ws.deleteStatus(slug, reassignTo);
    await this.refreshStatuses();
    if (reassigned > 0) await Promise.all([this.listItems(true), this.refreshStats()]);
    return reassigned;
  }

  // ---------- Bulk operations ----------
  /**
   * Run a batch of item operations, chunked, reporting progress as it goes.
   *
   * Partial failure is the normal case for `haventory/items/bulk`: successes
   * persist, failures come back per operation, and nothing is rolled back. The
   * caller gets both halves so it can show "39 of 42 moved" and retry only the
   * three that failed.
   */
  async bulkExecute(
    ops: BulkOperation[],
    opts: {
      chunkSize?: number;
      /** Called after every chunk with cumulative counts. */
      onProgress?: (done: number, total: number, failed: number) => void;
      /** Checked between chunks; the in-flight chunk always completes. */
      isCancelled?: () => boolean;
    } = {},
  ): Promise<BulkOutcome> {
    const chunkSize = Math.max(1, opts.chunkSize ?? BULK_CHUNK_SIZE);
    const succeeded: Item[] = [];
    const failed: BulkFailure[] = [];
    const succeededOpIds = new Set<string>();
    let done = 0;
    let cancelled = false;

    for (let i = 0; i < ops.length; i += chunkSize) {
      if (opts.isCancelled?.()) {
        cancelled = true;
        break;
      }
      const chunk = ops.slice(i, i + chunkSize);
      const byId = new Map(chunk.map((op) => [op.op_id, op]));
      try {
        const res = await this.run(() => this.ws.bulk(chunk));
        const results = res?.results ?? {};
        for (const [opId, result] of Object.entries(results)) {
          const op = byId.get(opId);
          if (result?.success) {
            succeededOpIds.add(opId);
            // `item_delete` succeeds with a null result — there is no item to merge.
            const item = result.result;
            if (item && typeof item.id === 'string') {
              succeeded.push(item);
              this.applyOptimistic(item);
            }
          } else if (op) {
            failed.push({ op, error: result?.error ?? unknownBulkError(), itemId: opTargetId(op) });
          }
        }
        // An op whose id never came back is reported rather than silently
        // dropped — the endpoint collapses duplicate op_ids to the last one.
        for (const op of chunk) {
          if (!(op.op_id in results)) {
            failed.push({
              op,
              error: unknownBulkError('no result returned for this operation'),
              itemId: opTargetId(op),
            });
          }
        }
      } catch (err) {
        // The whole call failed (envelope validation, rate limiting after every
        // retry, transport). Attribute it to each op in the chunk.
        const error = {
          code: errorCode(err),
          message: String((err as { message?: unknown } | undefined)?.message ?? 'Batch failed'),
        };
        for (const op of chunk) failed.push({ op, error, itemId: opTargetId(op) });
      }
      done += chunk.length;
      opts.onProgress?.(done, ops.length, failed.length);
    }

    // Deletes are not echoed as items — drop them from the list here.
    for (const op of ops) {
      if (op.kind !== 'item_delete' || !succeededOpIds.has(op.op_id)) continue;
      const id = opTargetId(op);
      if (id) this.removeById(id);
    }

    // Counts and per-location totals moved; refresh what the UI reads.
    void this.refreshStats().catch(() => undefined);
    void this.refreshDistinctValues().catch(() => undefined);
    this.scheduleTreeRefresh();

    return { succeeded, failed, cancelled };
  }

  // ---------- Import / export (data safety) ----------
  /**
   * Build a versioned backup document.
   *
   * `scope: 'view'` applies the active filter — the export endpoint accepts one,
   * and the document still carries each item's location ancestry so a filtered
   * backup stays self-consistent.
   */
  async exportDocument(scope: 'all' | 'view' = 'all'): Promise<ExportDocument> {
    return this.ws.exportDocument(scope === 'view' ? toWireFilter(this.state.value.filters) : undefined);
  }

  /** Validate + classify an import document without mutating state. */
  async previewImport(document: unknown, policy: ImportPolicy): Promise<ImportPreview> {
    return this.ws.importPreview(document, policy);
  }

  /** Apply an import document, then reload local caches to reflect the new dataset. */
  async executeImport(document: unknown, policy: ImportPolicy): Promise<ImportSummary> {
    const summary = await this.ws.importExecute(document, policy);
    await this.reloadAll();
    return summary;
  }

  /** Refresh every derived cache and the item list (used after a wholesale import). */
  async reloadAll(): Promise<void> {
    await Promise.all([
      this.refreshStats(),
      this.refreshHealth(),
      this.refreshLocationsFlat(),
      this.refreshLocationTree(),
      this.refreshDistinctValues(),
      this.refreshConfig(),
    ]);
    await this.listItems(true);
  }

  // ---------- Errors ----------
  private pushError(err: unknown, details?: { itemId?: string; changes?: ItemUpdate }) {
    // Home Assistant callWS returns an error envelope with {code, message, context}
    const anyErr = err as { code?: unknown; message?: unknown; context?: unknown; data?: unknown } | undefined;
    const code = errorCode(err);
    const transport = code === TRANSPORT_ERROR_CODE;
    // An outage fails every call in flight and every one the user tries next,
    // each of them with the same sentence. One entry stands for all of them —
    // the degraded stack above is what tracks the connection itself.
    if (transport && this.state.value.errorQueue.some((e) => e.code === TRANSPORT_ERROR_CODE)) return;
    // A transport rejection carries either nothing or a socket-level string; in
    // both cases the card's own wording is the only one worth showing.
    const message = transport ? TRANSPORT_ERROR_MESSAGE : String(anyErr?.message ?? 'Unknown error');
    const context = (anyErr?.context ?? anyErr?.data ?? null) as Record<string, unknown> | null;
    const entry = {
      id: `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      code,
      message,
      context: context ?? undefined,
      kind: code === 'conflict' ? 'conflict' as const : 'error' as const,
      itemId: details?.itemId,
      changes: details?.changes,
    };
    const next = this.state.value.errorQueue.concat([entry]);
    this.stateObs.set({ errorQueue: next });
  }

  dismissError(id: string) {
    const next = this.state.value.errorQueue.filter((e) => e.id !== id);
    this.stateObs.set({ errorQueue: next });
  }

  async refreshItem(itemId: string) {
    try {
      const latest = await this.ws.getItem(itemId);
      this.applyOptimistic(latest);
    } catch (err) {
      this.pushError(err);
    }
  }

  // ---------- Local mutations ----------
  private applyOptimistic(item: Item) {
    const items = this.state.value.items.slice();
    const idx = items.findIndex((x) => x.id === item.id);
    if (idx >= 0) items[idx] = item; else items.unshift(item);
    // A rolled-back delete puts the row back, so it is no longer gone.
    this.forgetRemoved(item.id);
    this.stateObs.set({ items });
  }

  private removeById(itemId: string) {
    const items = this.state.value.items.filter((x) => x.id !== itemId);
    this.noteRemoved(itemId);
    this.stateObs.set({ items });
  }

  /**
   * Remember an id the backend no longer has, newest last and bounded.
   *
   * A host with an open editor has to tell two disappearances apart: the row
   * fell out of the filtered page, where the typed edits are still worth
   * keeping, or the item is gone, where the form has nothing left to save
   * against. Only a real removal is recorded — a refetch that stops listing an
   * id says nothing about whether it still exists.
   */
  private noteRemoved(itemId: string) {
    if (this.removedIds.has(itemId)) return;
    this.removedIds.add(itemId);
    this.removedOrder.push(itemId);
    while (this.removedOrder.length > REMOVED_ID_MEMORY) {
      const evicted = this.removedOrder.shift();
      if (evicted !== undefined) this.removedIds.delete(evicted);
    }
  }

  private forgetRemoved(itemId: string) {
    if (!this.removedIds.delete(itemId)) return;
    const idx = this.removedOrder.indexOf(itemId);
    if (idx >= 0) this.removedOrder.splice(idx, 1);
  }

  /** True when this id was removed rather than merely filtered off the page. */
  wasRemoved(itemId: string): boolean {
    return this.removedIds.has(itemId);
  }
}

let bulkOpSeq = 0;

/**
 * Build a batch operation with an id that is unique for the process.
 *
 * The backend keys results by `op_id` and silently keeps only the last entry for
 * a duplicate, which would leave the client unable to say which op failed — so
 * ids are never derived from the item alone.
 */
export function makeBulkOp(
  kind: BulkOperation['kind'],
  payload: Record<string, unknown>,
): BulkOperation {
  bulkOpSeq += 1;
  const target = typeof payload.item_id === 'string' ? payload.item_id : 'op';
  return { op_id: `${kind}:${target}:${bulkOpSeq}`, kind, payload };
}

function opTargetId(op: BulkOperation): string | null {
  const id = op.payload?.item_id;
  return typeof id === 'string' ? id : null;
}

function unknownBulkError(message = 'Operation failed') {
  return { code: 'unknown_error', message };
}

function mergeUniqueById(existing: Item[], incoming: Item[]): Item[] {
  const map = new Map<string, Item>();
  for (const it of existing) map.set(it.id, it);
  for (const it of incoming) map.set(it.id, it);
  // Keep order: existing first then incoming new ones
  const incomingOnly = incoming.filter((i) => !existing.some((e) => e.id === i.id));
  return existing.map((e) => map.get(e.id)!) .concat(incomingOnly);
}
