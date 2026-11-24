-- Relayed signaling (docs/relay-signaling.md): the host's browser polls, the
-- guests connected to it get signaling over a WebRTC data channel instead.
--
-- Additive: a meeting without `relay` and a participant without it behave as
-- before.

-- 'host' when the meeting relays through its host; NULL otherwise. Set when
-- the meeting is created, from the RELAY_SIGNALING variable, so a running
-- meeting never changes its mind.
ALTER TABLE meetings ADD COLUMN relay TEXT;

-- Whether this participant's tab takes signaling over a data channel: 1 or 0
-- once its first poll said so, NULL before. Written when it changes, so at
-- most once per tab.
ALTER TABLE participants ADD COLUMN relay INTEGER;
