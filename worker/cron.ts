import { DELETE_AFTER_MS, EXPIRE_AFTER_MS } from './lib/timing'

/**
 * The daily cleanup (cron trigger in wrangler.jsonc), one D1 batch:
 * - a meeting nobody has been in for a day, past its scheduled end, ends as `expired`;
 * - meetings that ended more than a week ago are deleted with their people.
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
        db.prepare(`DELETE FROM participants WHERE meeting_code IN (SELECT code FROM meetings WHERE ended_at < ?1 - ${DELETE_AFTER_MS})`).bind(now),
        db.prepare(`DELETE FROM meetings WHERE ended_at < ?1 - ${DELETE_AFTER_MS}`).bind(now),
    ]
}

export async function cleanup(env: Env, now = Date.now()): Promise<void> {
    await env.DB.batch(cleanupStatements(env.DB, now))
}
