// The pages' security headers live in public/_headers (Workers static assets apply them).
// Nothing runs that file in a unit test, so this keeps its promises and index.html in step.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function headers(): Map<string, string> {
    const lines = read('public/_headers').split('\n').filter((line) => line.trim() && ! line.startsWith('#'))
    expect(lines[0]).toBe('/*')

    return new Map(lines.slice(1).map((line) => {
        const at = line.indexOf(':')

        return [line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()]
    }))
}

function policy(): Map<string, string[]> {
    return new Map((headers().get('content-security-policy') ?? '').split(';').map((part) => {
        const [name, ...sources] = part.trim().split(/\s+/)

        return [name, sources]
    }))
}

describe('the pages\' security headers', () => {
    it('let scripts come from this origin only, never inline or evaluated', () => {
        const csp = policy()
        expect(csp.get('default-src')).toEqual(["'self'"])
        expect(csp.get('script-src')).toEqual(["'self'"])
        expect(csp.get('connect-src')).toEqual(["'self'"])
        expect(csp.get('object-src')).toEqual(["'none'"])
        expect(csp.get('base-uri')).toEqual(["'none'"])
        expect([...csp.values()].flat()).not.toContain("'unsafe-eval'")
        expect([...csp.values()].flat()).not.toContain('*')
    })

    it('let video elements play camera streams and blobs', () => {
        expect(policy().get('media-src')).toEqual(expect.arrayContaining(["'self'", 'blob:', 'mediastream:']))
    })

    it('keep the app out of frames', () => {
        expect(policy().get('frame-ancestors')).toEqual(["'none'"])
        expect(headers().get('x-frame-options')).toBe('DENY')
    })

    it('keep the camera, the microphone and screen capture for this origin', () => {
        const permissions = headers().get('permissions-policy') ?? ''
        for (const feature of ['camera', 'microphone', 'display-capture']) expect(permissions).toContain(`${feature}=(self)`)
        expect(permissions).toContain('geolocation=()')
    })

    it('send no referrer and no sniffable types', () => {
        expect(headers().get('referrer-policy')).toBe('no-referrer')
        expect(headers().get('x-content-type-options')).toBe('nosniff')
    })
})

describe('index.html under that policy', () => {
    const html = read('index.html')

    it('has no inline script or event handler', () => {
        const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
        expect(scripts.length).toBeGreaterThan(0)
        for (const [, attributes, body] of scripts) {
            expect(attributes).toMatch(/\bsrc="\//)
            expect(body.trim()).toBe('')
        }
        expect(html).not.toMatch(/\son[a-z]+\s*=/i)
        expect(html).not.toMatch(/javascript:/i)
    })

    it('loads the theme before the app, from a file', () => {
        expect(html.indexOf('src="/theme.js"')).toBeGreaterThan(-1)
        expect(html.indexOf('src="/theme.js"')).toBeLessThan(html.indexOf('src="/src/main.ts"'))
        expect(read('public/theme.js')).toContain('holler:theme')
    })
})
