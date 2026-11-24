// The annotations' transport: the `annotations` data channel that every client opens to every
// peer (CHANNELS in ../holler). Kept apart from the client setup so the room only sees a Wire.

import type { CallClient } from '@packstub/holler'
import { CHANNELS } from '../holler'

export const LABEL = CHANNELS[0]

/** Past this many bytes waiting in a channel's buffer, a message is dropped rather than queued. */
const BUFFER_LIMIT = 256 * 1024

export interface WireHandlers {
    /** A message from a peer; `from` is the peer the channel belongs to, never something the message says. */
    message(from: string, data: unknown): void
    /** The channel to a peer opened (again after a reload on either side). */
    open(peerId: string): void
}

export interface Wire {
    /** To every peer in `to`, or to one. Never throws; a closed or full channel just misses it. */
    send(data: string, to: string[]): void
    listen(handlers: WireHandlers): () => void
}

export function hollerWire(client: CallClient, label = LABEL): Wire {
    return {
        send(data, to) {
            for (const id of to) {
                const channel = client.channel(label, id)
                if (! channel || channel.readyState !== 'open' || channel.bufferedAmount > BUFFER_LIMIT) continue
                try {
                    channel.send(data)
                } catch {
                    // Closing under us: the next message goes on the new channel.
                }
            }
        },
        listen(handlers) {
            const onChannel = ({ detail: { peer, channel, label: name } }: CustomEvent<{ peer: { id: string }, channel: RTCDataChannel, label: string }>) => {
                if (name !== label) return
                const id = peer.id
                channel.addEventListener('message', (event: MessageEvent) => handlers.message(id, event.data))
                handlers.open(id)
            }
            client.addEventListener('datachannel', onChannel)

            return () => client.removeEventListener('datachannel', onChannel)
        },
    }
}

/** A wire that goes nowhere (the dev demo, tests). `deliver` plays a peer's message in. */
export function localWire(): Wire & { sent: { data: string, to: string[] }[], deliver(from: string, data: unknown): void, connect(peerId: string): void } {
    let handlers: WireHandlers | null = null

    return {
        sent: [],
        send(data, to) {
            this.sent.push({ data, to })
        },
        listen(h) {
            handlers = h

            return () => { handlers = null }
        },
        deliver(from, data) {
            handlers?.message(from, data)
        },
        connect(peerId) {
            handlers?.open(peerId)
        },
    }
}
