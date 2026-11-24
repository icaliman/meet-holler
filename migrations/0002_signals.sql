-- Holler signals waiting to be read: offers, answers, ICE candidates, resets
-- and mute/camera/screen states, one row per recipient. AUTOINCREMENT keeps
-- ids growing even after every row was deleted, so a client's cursor never
-- skips a new signal. A row is deleted once the recipient's tab polls past it,
-- when the recipient leaves, when the meeting ends, or by the daily cleanup.

CREATE TABLE signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_code TEXT NOT NULL,
    to_id TEXT NOT NULL,
    from_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,                 -- JSON
    created_at INTEGER NOT NULL
);

-- The one index: a poll reads "my signals after the cursor".
CREATE INDEX signals_to ON signals (to_id, id);
