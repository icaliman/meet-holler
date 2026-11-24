import { env, exports } from 'cloudflare:workers'

export type ApiResponse<T = any> = { status: number, body: T, headers: Headers }

type Options = {
    body?: unknown
    token?: string
    hostKey?: string
    ip?: string
    headers?: Record<string, string>
}

let ipCounter = 0
/** Every request gets its own address unless a test names one, so the per-IP limits stay out of the way. */
export const freshIp = () => `10.${(++ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`

export async function api<T = any>(method: string, path: string, options: Options = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { 'cf-connecting-ip': options.ip ?? freshIp(), ...options.headers }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    if (options.hostKey) headers['X-Host-Key'] = options.hostKey

    const response = await exports.default.fetch(`http://meet.test${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    })

    const text = await response.text()
    let body: any = text
    try {
        body = text ? JSON.parse(text) : null
    } catch {}

    return { status: response.status, body, headers: response.headers }
}

export async function createMeeting(fields: Record<string, unknown> = {}) {
    const response = await api('POST', '/api/meetings', { body: { visibility: 'public', ...fields } })
    if (response.status !== 201) throw new Error(`create failed: ${response.status} ${JSON.stringify(response.body)}`)

    return { code: response.body.meeting.code as string, hostKey: response.body.hostKey as string, meeting: response.body.meeting }
}

export async function join(code: string, fields: Record<string, unknown> = {}) {
    return api('POST', `/api/meetings/${code}/join`, { body: { name: 'Guest', ...fields } })
}

/** Joins and expects it to work: the token and the participant. */
export async function joined(code: string, fields: Record<string, unknown> = {}) {
    const response = await join(code, fields)
    if (response.status !== 201) throw new Error(`join failed: ${response.status} ${JSON.stringify(response.body)}`)

    return { token: response.body.token as string, participant: response.body.participant, meeting: response.body.meeting }
}

export async function row<T = any>(sql: string, ...params: unknown[]): Promise<T | null> {
    return env.DB.prepare(sql).bind(...params).first<T>()
}

export async function rows<T = any>(sql: string, ...params: unknown[]): Promise<T[]> {
    return (await env.DB.prepare(sql).bind(...params).all<T>()).results
}
