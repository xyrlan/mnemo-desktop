import { register } from '../memory/register'
import { AccountsPanel } from './Accounts'

export { AccountsPanel }

register({ id: 'accounts', title: 'Accounts', hint: 'each account, its plan windows and when they reset', Component: AccountsPanel })
