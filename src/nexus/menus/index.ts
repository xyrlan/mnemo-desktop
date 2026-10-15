import { registerMenu } from '../ui/menus'
import { shipMenu } from './app'

// `view.tsx` imports this file eagerly: the ship's right-click menus are there from the start.
registerMenu(shipMenu)

export { shipMenu }
