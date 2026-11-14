import { errorCode, TRANSPORT_ERROR_CODE } from './error-queue';
import { Coalesced } from './scheduling';
import { Slice } from './slice';
import type { DegradedState, StoreState, Unsubscribe } from './types';
import type { WSClient } from './ws';

/** Consecutive transport failures before the card declares the connection lost. */
const CONNECTION_LOST_THRESHOLD = 2;

/**
 * How long a closed socket may stay closed before the card says so. HA retries
 * at 0, 1, 3 and 6 s; a Wi-Fi roam lands on the 3 s rung and must stay silent.
 */
const CONNECTION_LOST_GRACE_MS = 4_500;

export const NO_DEGRADATION: DegradedState = {
  connectionLost: false,
  reloading: false,
  liveUpdates: 'live',
  liveUpdatesReason: null,
  nextLiveRetryAt: null,
};

/** `ConnectionHealth.run`, as the parts that send commands receive it. */
export type Run = <T>(fn: () => Promise<T>) => Promise<T>;

export type ConnectionSlice = Pick<StoreState, 'connected' | 'degraded'>;

/**
 * What the card knows about its link to the backend: whether the socket is up,
 * whether calls reach a server, and whether live updates flow. Every command
 * goes through `run`, so any of them can grade the connection; the live
 * subscriptions report into `degraded` and `connected` through here too.
 */
export class ConnectionHealth {
  readonly slice = new Slice<ConnectionSlice>({
    connected: { items: false, stats: false },
    degraded: { ...NO_DEGRADATION },
  });
  private consecutiveTransportFailures = 0;
  /** Counts down the grace period on a closed socket; idle while it is open. */
  private readonly connectionLostGrace = new Coalesced();
  private connectionReadyUnsub: Unsubscribe | null = null;
  private connectionLostUnsub: Unsubscribe | null = null;

  constructor(private readonly ws: WSClient) {}

  /** Run a command and grade what its outcome says about the connection. */
  readonly run: Run = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      const out = await fn();
      this.noteSuccess();
      return out;
    } catch (err) {
      this.noteFailure(err);
      throw err;
    }
  };

  /**
   * Follow the socket in both directions. HA re-issues its subscriptions before
   * `ready`, so an area renamed while the socket was down reaches nobody and
   * only a refetch catches it; and an idle surface learns of an outage only here.
   */
  watchConnectionGaps(onReady: () => void) {
    this.connectionReadyUnsub?.();
    this.connectionLostUnsub?.();
    this.connectionReadyUnsub = this.ws.onConnectionReady(() => {
      this.connectionLostGrace.cancel();
      this.noteSuccess();
      onReady();
    });
    this.connectionLostUnsub = this.ws.onConnectionLost(() => this.startConnectionLostGrace());
  }

  /** Declare the connection lost unless it comes back inside the grace period. */
  private startConnectionLostGrace() {
    // A second `disconnected` inside the window is the same outage, and
    // restarting the countdown would postpone the banner indefinitely.
    if (this.connectionLostGrace.pending) return;
    this.connectionLostGrace.schedule(CONNECTION_LOST_GRACE_MS, () =>
      this.setDegraded({ connectionLost: true }),
    );
  }

  setDegraded(patch: Partial<DegradedState>) {
    const cur = this.slice.value.degraded;
    // A no-op patch publishes nothing: every subscriber re-renders on notify.
    const keys = Object.keys(patch) as (keyof DegradedState)[];
    if (keys.every((key) => cur[key] === patch[key])) return;
    this.slice.set({ degraded: { ...cur, ...patch } });
  }

  /** Whether the live subscriptions are open; the items and stats flags move together. */
  setConnected(live: boolean) {
    this.slice.set({ connected: { items: live, stats: live } });
  }

  private noteSuccess() {
    this.consecutiveTransportFailures = 0;
    this.setDegraded({ connectionLost: false });
  }

  /**
   * A refusal that came back over the socket proves the transport works. A run
   * of failures that did not catches outages that close no socket.
   */
  private noteFailure(err: unknown) {
    if (errorCode(err) !== TRANSPORT_ERROR_CODE) {
      this.consecutiveTransportFailures = 0;
      return;
    }
    this.consecutiveTransportFailures += 1;
    if (this.consecutiveTransportFailures >= CONNECTION_LOST_THRESHOLD) {
      this.setDegraded({ connectionLost: true });
    }
  }

  /** Forget every sign of trouble, ahead of a user-triggered recovery. */
  reset() {
    this.consecutiveTransportFailures = 0;
    this.connectionLostGrace.cancel();
    this.setDegraded({ ...NO_DEGRADATION });
  }

  dispose() {
    // Held by HA's connection, which outlives every card.
    this.connectionReadyUnsub?.();
    this.connectionLostUnsub?.();
    this.connectionReadyUnsub = this.connectionLostUnsub = null;
    this.connectionLostGrace.cancel();
    this.setConnected(false);
  }
}
