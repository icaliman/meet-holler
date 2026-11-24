// What went wrong, in one friendly sentence each (docs/design.md, Voice).

import { ApiError } from './api'

export function explain(error: unknown): string {
    if (! (error instanceof ApiError)) return 'Something went wrong on our side. Try again in a moment.'

    switch (error.code) {
        case 'network': return 'We could not reach the server. Check your connection and try again.'
        case 'not_found': return "We can't find that meeting. Check the code, or start a new one."
        case 'ended': return 'This meeting has ended.'
        case 'full': return 'This meeting is full. It holds four people, and four are in.'
        case 'locked': return 'The host has locked this meeting. Ask them to unlock it.'
        case 'passcode_required': return 'This meeting is private. Enter the passcode the host gave you.'
        case 'passcode_wrong': return "That passcode doesn't match. Check with the host and try again."
        case 'rate_limited': return 'Too many tries in a short time. Wait a minute, then try again.'
        case 'forbidden': return "You can't do that in this meeting."
        case 'invalid': return error.message || 'Something in the form is not right. Check it and try again.'
    }

    return 'Something went wrong on our side. Try again in a moment.'
}
