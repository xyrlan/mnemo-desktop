// The pet overlay over the app with nothing running: it rests in the bottom-right corner in the
// vault's pose. Shoot with `node tools/preview/shot.mjs pet`.
import { scenario } from '../scenario.mjs'
import { appIpc } from '../fixtures/app.mjs'

scenario('pet', { ipc: appIpc() })
