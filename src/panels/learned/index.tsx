import { register } from '../memory/register'
import { LearnedPanel } from './Learned'

export { LearnedPanel }

register({ id: 'learned', title: 'Learned', hint: 'what mnemo learned from your history, kept or dropped', Component: LearnedPanel })
