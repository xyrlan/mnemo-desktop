import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { WindowHost } from '../../ui/Window'
import { closeWindow, openWindow, windowDef } from '../../ui/windows'
import './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('the bar’s PROJECTS opens the window registered at import', async () => {
  expect(windowDef('projects')?.title).toBe('Projects')
  const root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root.render(<WindowHost />))
  await act(async () => openWindow('projects'))
  expect(document.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Projects')
  expect(document.querySelector('[data-nx-projects]')).not.toBeNull()
  await act(async () => closeWindow())
  await act(async () => root.unmount())
})
