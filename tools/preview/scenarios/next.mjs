// The recreation's frame on the synthetic world, one scenario per view. A piece adds its own
// states in its own `next-<piece>*.mjs` beside this file.
import { scenario } from '../scenario.mjs'
import { next, sessionTitled } from '../fixtures/next.mjs'

scenario('next-orbit', next({ v: 'orbit' }))
scenario('next-console', next({ v: 'console', s: sessionTitled('Order status history') }))
scenario('next-score', next({ v: 'score', s: sessionTitled('Idempotent retries') }))
