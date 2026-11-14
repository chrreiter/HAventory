import { errorCode } from './error-queue';
import { Coalesced, Latest } from './scheduling';
import type { ConnectionHealth } from './connection-health';
import type { AnyEventPayload, LiveEventPayload, LiveUpdatePause, StoreFilters, Unsubscribe } from './types';
import type { WSClient } from './ws';

/**
 * Re-subscribes while the backend reports itself unavailable. Generous, because
 * a config-entry reload refuses for as long as setup takes.
 */
const SUBSCRIBE_UNAVAILABLE_ATTEMPTS = 7;

const SUBSCRIBE_RETRY_MAX_MS = 30_000;

/** Topics `subscribeTopics` opens as one round: items, stats, locations, statuses. */
const SUBSCRIBE_TOPIC_COUNT = 4;

/**
 * Re-opens after HA refuses the area-registry watch. Spent quietly: a refusal
 * costs only area freshness, and the card keeps the areas it fetched at boot.
 */
const AREA_REGISTRY_RETRY_ATTEMPTS = 3;

/** Event action the backend sends every open subscription as its entry tears down. */
const BACKEND_UNAVAILABLE_ACTION = 'unavailable';

/** Exponential backoff off the base delay, capped. */
export function subscribeRetryDelayMs(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** attempt, SUBSCRIBE_RETRY_MAX_MS);
}

export interface LiveHandlers {
  onItemsEvent(evt: LiveEventPayload): void;
  onStatsEvent(evt: LiveEventPayload): void;
  onLocationsEvent(evt: LiveEventPayload): void;
  /** Any statuses event: the vocabulary is re-read whole. */
  onStatusesEvent(): void;
  /** An area-registry event, or a re-opened watch catching up. */
  onAreasChanged(): void;
  /** Live updates came back after the backend was away. */
  onRestored(): void;
}

/**
 * The live topic subscriptions (items, stats, locations, statuses) opened as
 * one round, the re-subscribe retry ladder, the backend-unavailable handling,
 * and the area-registry watch with its quiet retries.
 */
export class LiveSubscriptions {
  private itemsUnsub: Unsubscribe | null = null;
  private statsUnsub: Unsubscribe | null = null;
  private locationsUnsub: Unsubscribe | null = null;
  private statusesUnsub: Unsubscribe | null = null;
  private areaRegistryUnsub: Unsubscribe | null = null;
  private readonly subscribeRetry = new Coalesced();
  private readonly areaRegistryRetry = new Coalesced();
  private readonly latestSubscribeRound = new Latest();
  private readonly latestAreaWatch = new Latest();
  /** Subscribes in the current round that have not resolved or been refused yet. */
  private subscribePending = 0;
  /** First refusal seen in the current round, if any. */
  private subscribeRefusal: { err: unknown } | null = null;
  /** Automatic re-subscribes already spent on the current outage. */
  private subscribeAttempt = 0;
  /** Re-opens of the area-registry watch already spent on the current refusal. */
  private areaRegistryAttempt = 0;

  constructor(
    private readonly ws: WSClient,
    private readonly health: ConnectionHealth,
    private readonly pushError: (err: unknown) => void,
    private readonly getFilters: () => StoreFilters,
    private readonly retryBaseMs: number,
    private readonly handlers: LiveHandlers,
  ) {}

  /** Keep the area cache current while mounted; any registry event triggers a refetch. */
  watchAreaRegistry(resetRetryBudget = true) {
    this.areaRegistryRetry.cancel();
    if (resetRetryBudget) this.areaRegistryAttempt = 0;
    // A re-open re-reads the cache, since the registry could have moved unheard.
    const catchUp = this.areaRegistryAttempt > 0;
    const current = this.latestAreaWatch.claim();
    this.areaRegistryUnsub?.();
    this.areaRegistryUnsub = this.ws.subscribeAreaRegistry(() => this.handlers.onAreasChanged(), {
      onOpen: () => {
        if (catchUp && current()) this.handlers.onAreasChanged();
      },
      onError: () => {
        if (current()) this.onAreaRegistryRefused();
      },
    });
  }

  /** HA refused the registry watch: back off and retry without telling the user. */
  private onAreaRegistryRefused() {
    if (this.areaRegistryAttempt >= AREA_REGISTRY_RETRY_ATTEMPTS) return;
    const delay = subscribeRetryDelayMs(this.areaRegistryAttempt, this.retryBaseMs);
    this.areaRegistryAttempt += 1;
    this.areaRegistryRetry.schedule(delay, () => this.watchAreaRegistry(false));
  }

  /**
   * (Re)open the four topic subscriptions as one round. Live updates count as
   * restored only once every subscribe in the newest round has been accepted.
   */
  subscribeTopics(resetRetryBudget = true) {
    this.subscribeRetry.cancel();
    if (resetRetryBudget) this.subscribeAttempt = 0;
    const round = this.latestSubscribeRound.claim();
    this.subscribePending = SUBSCRIBE_TOPIC_COUNT;
    this.subscribeRefusal = null;
    const onOpen = () => this.onSubscribeSettled(round, null);
    const onError = (err: unknown) => this.onSubscribeSettled(round, { err });
    const opts = { onError, onOpen };
    // The teardown signal arrives on every open topic; handle it ahead of them.
    const onEvent = (handle: (evt: LiveEventPayload) => void) => (evt: AnyEventPayload) => {
      if (evt.action === BACKEND_UNAVAILABLE_ACTION) this.onBackendUnavailable();
      else handle(evt);
    };
    const { locationIds, areaId } = this.getFilters();

    this.itemsUnsub?.();
    this.itemsUnsub = this.ws.subscribe(
      'items',
      onEvent((evt) => this.handlers.onItemsEvent(evt)),
      {
        location_ids: locationIds.length ? [...locationIds] : undefined,
        area_id: areaId ?? undefined,
        include_subtree: true,
        ...opts,
      },
    );
    this.statsUnsub?.();
    this.statsUnsub = this.ws.subscribe(
      'stats',
      onEvent((evt) => this.handlers.onStatsEvent(evt)),
      opts,
    );
    this.locationsUnsub?.();
    this.locationsUnsub = this.ws.subscribe(
      'locations',
      onEvent((evt) => this.handlers.onLocationsEvent(evt)),
      opts,
    );
    this.statusesUnsub?.();
    // Any event re-reads the whole (small) vocabulary rather than patching it.
    this.statusesUnsub = this.ws.subscribe(
      'statuses',
      onEvent(() => this.handlers.onStatusesEvent()),
      opts,
    );
  }

  /**
   * The config entry serving these subscriptions is tearing down. A reload ends
   * by itself, so the card waits it out on the retry backoff; the first attempt
   * is scheduled because the backend mid-teardown would refuse it.
   */
  private onBackendUnavailable() {
    if (this.health.slice.value.degraded.liveUpdatesReason === 'unavailable') return;
    this.health.setConnected(false);
    this.subscribeAttempt = 0;
    this.scheduleReopen('unavailable');
  }

  /** Fold one subscribe outcome into its round, and act once the round is complete. */
  private onSubscribeSettled(round: () => boolean, refusal: { err: unknown } | null) {
    if (!round()) return; // a newer round has taken over
    if (refusal && !this.subscribeRefusal) this.subscribeRefusal = refusal;
    if (this.subscribePending > 0) this.subscribePending -= 1;
    if (this.subscribePending > 0) return;

    const refused = this.subscribeRefusal;
    if (!refused) {
      const wasUnavailable = this.health.slice.value.degraded.liveUpdatesReason === 'unavailable';
      this.subscribeAttempt = 0;
      this.health.setConnected(true);
      this.health.setDegraded({ liveUpdates: 'live', liveUpdatesReason: null, nextLiveRetryAt: null });
      // Every event while the backend was away went to subscriptions that no
      // longer existed, so re-read everything.
      if (wasUnavailable) this.handlers.onRestored();
      return;
    }
    this.onSubscribeRefused(refused.err);
  }

  /**
   * A refused subscribe means live updates are gone, silently. Two refusals are
   * waited out on the backoff: `storage_error` (no config entry, which a reload
   * clears) and `unknown_command` (a restarting instance serves the view before
   * the integration is set up). Any other refusal is reported at once.
   */
  private onSubscribeRefused(err: unknown) {
    this.health.setConnected(false);

    const code = errorCode(err);
    const reason: LiveUpdatePause | null =
      code === 'storage_error' || code === 'unknown_command' ? 'unavailable' : null;
    if (reason === null) {
      this.health.setDegraded({
        connectionLost: true,
        liveUpdates: 'paused',
        liveUpdatesReason: null,
        nextLiveRetryAt: null,
      });
      this.pushError(err);
      return;
    }

    if (this.subscribeAttempt >= SUBSCRIBE_UNAVAILABLE_ATTEMPTS) {
      this.health.setDegraded({ liveUpdates: 'paused', liveUpdatesReason: reason, nextLiveRetryAt: null });
      this.pushError(err);
      return;
    }

    this.scheduleReopen(reason);
  }

  /** Book the next re-subscribe and say so, so the banner can show the wait. */
  private scheduleReopen(reason: LiveUpdatePause) {
    const delay = subscribeRetryDelayMs(this.subscribeAttempt, this.retryBaseMs);
    this.subscribeAttempt += 1;
    this.health.setDegraded({
      liveUpdates: 'retrying',
      liveUpdatesReason: reason,
      nextLiveRetryAt: Date.now() + delay,
    });
    this.subscribeRetry.schedule(delay, () => this.subscribeTopics(false));
  }

  /** Release the subscriptions and cancel the pending retries. */
  dispose() {
    this.itemsUnsub?.();
    this.statsUnsub?.();
    this.locationsUnsub?.();
    this.statusesUnsub?.();
    this.areaRegistryUnsub?.();
    this.itemsUnsub = this.statsUnsub = this.locationsUnsub = this.statusesUnsub = null;
    this.areaRegistryUnsub = null;
    this.latestSubscribeRound.invalidate();
    this.latestAreaWatch.invalidate();
    this.subscribeRetry.cancel();
    this.areaRegistryRetry.cancel();
  }
}
