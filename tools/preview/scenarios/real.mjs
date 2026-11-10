import { scenario } from '../scenario.mjs'
import { appIpc } from '../fixtures/app.mjs'
const real = (route) => ({ storage: { 'mnemo.next': '1', 'mnemo.world': 'capture', 'mnemo.route': '#' + new URLSearchParams(route).toString() }, ipc: appIpc({}) })
scenario('real-orbit', real({ v: 'orbit' }))
scenario('real-console', real({ v: 'console' }))
scenario('real-score', real({ v: 'score' }))
