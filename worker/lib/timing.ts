/** People in one meeting: the holler-js mesh uploads one copy of your media per peer. */
export const CAPACITY = 4

/** A tab that holds a side writes its heartbeat at most this often (D1 writes are the budget). */
export const HEARTBEAT_MS = 10_000
/** How stale a live tab's heartbeat can look: the heartbeat interval plus the slowest poll in a call (5 s). */
export const SEEN_GRACE_MS = 15_000
/** A side whose tab has not polled for this long can be claimed by another tab. */
export const CLAIM_STALE_MS = 20_000
/** Someone in the call whose tab went quiet this long is dropped. */
export const DROP_AFTER_MS = 45_000
/** Someone admitted who never answered (closed the tab on the camera prompt) is missed. */
export const RING_TIMEOUT_MS = 60_000
/** Someone on hold with no tab polling is dropped. */
export const HOLD_TIMEOUT_MS = 120_000
/** People who left stay in `peers` this long, so every client sees them go. */
export const LEFT_VISIBLE_MS = 60_000

/** The cleanup deletes signals nobody read within this long. */
export const SIGNAL_TTL_MS = 60_000

/** A waiting guest's `/me` poll writes its heartbeat at most this often. */
export const WAITING_HEARTBEAT_MS = 20_000
/** A waiting guest who stopped polling this long ago is off the host's list. */
export const WAITING_STALE_MS = 60_000

/** Guests in a waiting room at once (the ones still asking); the host's list and every poll carry them. */
export const MAX_WAITING = 20
/** Participant records one meeting keeps: every poll reads them all, so a flood of joins must not grow them without end. */
export const MAX_RECORDS = 60
/** People who left, were denied or removed, or stopped waiting are forgotten this long after. */
export const PRUNE_AFTER_MS = 10 * 60_000

/** Wrong passcodes allowed per meeting in one window. */
export const PASSCODE_MAX_FAILURES = 10
export const PASSCODE_WINDOW_MS = 15 * 60_000

/** The cleanup ends a meeting nobody has been in for this long. */
export const EXPIRE_AFTER_MS = 24 * 60 * 60_000
/** And deletes ended meetings after this long. */
export const DELETE_AFTER_MS = 7 * 24 * 60 * 60_000
