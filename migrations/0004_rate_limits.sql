-- Rate limits that hold across Worker instances (worker/lib/ratelimit.ts): one
-- row per client and bucket, a fixed window and its count. Only for requests
-- that write to D1 anyway and are rare: creating a meeting, joining one. A row
-- is written while the client is under its limit; the daily cleanup deletes
-- the ones whose window passed.
--
-- Numbered 0004: 0003 is the relay migration of PR #15. They are independent.

CREATE TABLE rate_limits (
    key TEXT PRIMARY KEY,                  -- '<bucket>:<address or IPv6 /64>', or '<bucket>:*' for everyone together
    window_start INTEGER NOT NULL,         -- ms since the epoch
    count INTEGER NOT NULL
) WITHOUT ROWID;
