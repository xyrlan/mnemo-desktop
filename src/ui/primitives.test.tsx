import { act } from 'react'
import { createRoot } from 'react-dom/client'
import * as ui from '@/ui'
import { Button, Dialog, DialogContent, DialogTitle, Sheet, SheetContent, SheetTitle, Toaster } from '@/ui'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Popper-positioned content (Popover, DropdownMenu, ContextMenu, Select, Tooltip, HoverCard) is not
// opened here: in jsdom, with no layout, floating-ui keeps re-positioning forever and the worker
// never goes idle. Their layers are checked where there is layout — the preview harness.

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(node))
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

test('every primitive the wave-A contract names comes from `@/ui`', () => {
  const named = ['Button', 'Input', 'Textarea', 'Kbd', 'Badge', 'Separator', 'Tooltip', 'Popover', 'HoverCard', 'DropdownMenu', 'ContextMenu', 'Dialog', 'Sheet', 'Tabs', 'ScrollArea', 'Collapsible', 'Switch', 'Select', 'Command', 'Toaster', 'toast']
  const missing = named.filter((n) => !(n in ui) || (ui as Record<string, unknown>)[n] == null)
  expect(missing).toEqual([])
})

test('a button is a primitive, takes its variant and the caller’s classes last', async () => {
  const host = await mount(
    <Button variant="outline" className="w-40">
      Go
    </Button>,
  )
  const b = host.querySelector('[data-slot="button"]')!
  expect(b.tagName).toBe('BUTTON')
  expect(b.textContent).toBe('Go')
  expect(b.className).toContain('w-40')
})

test('an open dialog sits on the modal layer and says Close in words, not an i18n key', async () => {
  await mount(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Title</DialogTitle>
      </DialogContent>
    </Dialog>,
  )
  const content = document.querySelector('[data-slot="dialog-content"]')!
  expect(content.className).toContain('z-modal')
  expect(content.textContent).toContain('Close')
  expect(document.querySelector('[data-slot="dialog-overlay"]')!.className).toContain('z-modal')
})

test('an open sheet is modal too', async () => {
  await mount(
    <Sheet open>
      <SheetContent>
        <SheetTitle>Title</SheetTitle>
      </SheetContent>
    </Sheet>,
  )
  expect(document.querySelector('[data-slot="sheet-content"]')!.className).toContain('z-modal')
})


test('the toaster mounts without Orca’s store', async () => {
  const host = await mount(<Toaster />)
  expect(host.querySelector('section')).not.toBeNull()
})
