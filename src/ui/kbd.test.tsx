import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Kbd, KbdGroup } from '@/ui'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('a keycap per key, marked as a primitive, taking the caller’s classes last', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd className="text-foreground">K</Kbd>
      </KbdGroup>,
    ),
  )
  const keys = host.querySelectorAll('[data-slot="kbd"]')
  expect([...keys].map((k) => k.textContent)).toEqual(['⌘', 'K'])
  expect(keys[0].tagName).toBe('KBD')
  expect(keys[1].className).toContain('text-foreground')
  expect(keys[1].className).not.toContain('text-muted-foreground')
  expect(host.querySelector('[data-slot="kbd-group"]')).not.toBeNull()
  await act(async () => root.unmount())
  host.remove()
})
