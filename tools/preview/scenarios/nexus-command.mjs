// The fleet's command line open over the `nexus` ship (#469): `/` pressed with nothing focused, so
// the line floats over the bridge's top edge with `/` typed and every verb suggested under it.
import { getScenario, scenario } from '../scenario.mjs'
import './nexus.mjs'

scenario('nexus-command', {
  ipc: (cmd, args) => getScenario('nexus').ipc(cmd, args),
  drive: async (page) => {
    await page.keyboard.press('/')
    await page.waitForSelector('[data-fleet-verbs]')
  },
})
