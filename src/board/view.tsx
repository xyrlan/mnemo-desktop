import { registerPaneView } from '../panes/registry'
import { register } from '../actions/registry'
import { store } from '../layout/app-store'
import Board from './Board'

registerPaneView('board', Board)

export const openBoard = () => store.getState().openView('board', {}, 'auto', 'board')

register({ id: 'board.open', title: 'Open board (GitHub Project or issues)', run: openBoard })
