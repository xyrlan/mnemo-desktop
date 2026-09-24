import { cn } from '@/ui/cn'

test('joins conditional parts, dropping the falsy ones', () => {
  expect(cn('a', false && 'b', null, undefined, { c: true, d: false }, ['e'])).toBe('a c e')
})

test('a later Tailwind class replaces an earlier one of the same kind', () => {
  expect(cn('px-2 text-sm', 'px-4')).toBe('text-sm px-4')
  expect(cn('text-state-working', 'text-state-done')).toBe('text-state-done')
  expect(cn('text-sm', 'text-state-done')).toBe('text-sm text-state-done')
})

test('the stacking names from theme.css merge like z-index', () => {
  expect(cn('z-popover', 'z-menu')).toBe('z-menu')
  expect(cn('z-10', 'z-tooltip')).toBe('z-tooltip')
  expect(cn('shadow-md', 'shadow-floating')).toBe('shadow-floating')
})
