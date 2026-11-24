-- Meetings and the people in them. Both tables are WITHOUT ROWID with a text
-- key, so a row is one B-tree entry: D1 counts every index entry as a written
-- row, and the free plan allows 100k of those a day.

CREATE TABLE meetings (
    code TEXT PRIMARY KEY,                 -- ten characters, see worker/lib/codes.ts
    title TEXT,
    visibility TEXT NOT NULL,              -- public | private
    passcode_hash TEXT,                    -- pbkdf2-sha256$<iterations>$<salt>$<hash>, private meetings only
    waiting_room INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    scheduled_at INTEGER,                  -- ms since the epoch; null for an instant meeting
    duration_min INTEGER,
    host_name TEXT,
    host_key_hash TEXT NOT NULL,           -- SHA-256 of the hostKey, hex
    created_at INTEGER NOT NULL,
    opened_at INTEGER,                     -- the host joined (opens a scheduled meeting early)
    answered_at INTEGER,                   -- the call first had two people
    ended_at INTEGER,
    end_reason TEXT,                       -- ended (by the host) | expired (by the cleanup)
    pass_failures INTEGER NOT NULL DEFAULT 0,
    pass_window INTEGER                    -- start of the wrong-passcode window
) WITHOUT ROWID;

CREATE TABLE participants (
    id TEXT PRIMARY KEY,
    meeting_code TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,                    -- host | guest
    -- waiting | denied | removed (the meeting) and ringing | joined | on_hold |
    -- left | declined | missed | dropped (the Holler call, once admitted)
    status TEXT NOT NULL,
    seat INTEGER,                          -- admission order in the meeting, from 0
    tab TEXT,                              -- the browser tab holding this side of the call
    seen_at INTEGER,                       -- last heartbeat (written at most every 10 s)
    claim_nonce TEXT,                      -- set by the poll that took the side from another tab
    created_at INTEGER NOT NULL,
    admitted_at INTEGER,
    left_at INTEGER
) WITHOUT ROWID;

CREATE INDEX participants_meeting ON participants (meeting_code);
