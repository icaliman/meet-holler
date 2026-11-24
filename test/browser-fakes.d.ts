// Types for browser-fakes.js, as far as the tests use them.
export function installBrowserGlobals(devices?: unknown): unknown
export const FakeRTCPeerConnection: any
export const FakeMediaStream: any
export const FakeTrack: any
export function fakeDevices(options?: { camera?: boolean }): any
export function joinChannels(a: { channels: Map<string, any> }, b: { channels: Map<string, any> }): void
