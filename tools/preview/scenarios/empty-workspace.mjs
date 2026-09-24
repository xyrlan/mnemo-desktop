// The app as it opens with no saved workspace and nothing in history: Home, empty.
import { scenario } from '../scenario.mjs'
import { appIpc } from '../fixtures/app.mjs'

scenario('empty-workspace', { ipc: appIpc() })
