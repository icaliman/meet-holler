import { DELETE_AFTER_MS, EXPIRE_AFTER_MS, SIGNAL_TTL_MS } from './lib/timing'

/**
 * The daily cleanup (cron trigger in wrangler.jsonc), one D1 batch:
 * - a meeting nobody has been in for a day, past its scheduled end, ends as `expired`;
 * - meetings that ended more than a week ago are deleted with their people;
 * - signals nobody read within a minute are deleted (their recipient's tab is gone);
 * - rate-limit counters whose window passed are deleted.
 */
export function cleanupStatements(db: D1Database, now: number): D1PreparedStatement[] {
    return [
        db.prepare(`
            UPDATE meetings SET ended_at = ?1, end_reason = 'expired'
            WHERE ended_at IS NULL
              AND COALESCE(scheduled_at + duration_min * 60000, created_at) < ?1 - ${EXPIRE_AFTER_MS}
              AND NOT EXISTS (
                  SELECT 1 FROM participants p
                  WHERE p.meeting_code = meetings.code AND COALESCE(p.seen_at, p.admitted_at, p.created_at) >= ?1 - ${EXPIRE_AFTER_MS}
              )
        `).bind(now),
        db.prepare(`DELETE FROM signals WHERE created_at < ?1 - ${SIGNAL_TTL_MS} OR meeting_code IN (SELECT code FROM meetings WHERE ended_at IS NOT NULL)`).bind(now),
        db.prepare(`DELETE FROM participants WHERE meeting_code IN (SELECT code FROM meetings WHERE ended_at < ?1 - ${DELETE_AFTER_MS})`).bind(now),
        db.prepare(`DELETE FROM meetings WHERE ended_at < ?1 - ${DELETE_AFTER_MS}`).bind(now),
        // Rate-limit windows (lib/ratelimit.ts) that passed: the longest is an hour.
        db.prepare(`DELETE FROM rate_limits WHERE window_start < ?1 - ${EXPIRE_AFTER_MS}`).bind(now),
    ]
}

/**
 * Every 15 minutes: signals nobody read within a minute. Polls and new signals
 * delete what they pass, so this is for what is left behind when everyone in
 * a meeting just stops asking; it keeps the table from growing between two
 * daily runs.
 */
export async function sweepSignals(env: Env, now = Date.now()): Promise<void> {
    await env.DB.prepare(`DELETE FROM signals WHERE created_at < ?1 - ${SIGNAL_TTL_MS}`).bind(now).run()
}

export async function cleanup(env: Env, now = Date.now()): Promise<void> {
    await env.DB.batch(cleanupStatements(env.DB, now))
}
