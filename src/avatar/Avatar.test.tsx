import { act } from 'react'
import { createRoot } from 'react-dom/client'
import Avatar from './Avatar'
import { SCENES } from './scenes'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const render = async (ui: React.ReactElement) => {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(ui))
  return { host, root }
}

test('an action scene draws its pixels and carries its keyframe class', async () => {
  const { host } = await render(<Avatar scene="reflex" size={88} />)
  const svg = host.querySelector('svg')!
  expect(svg.getAttribute('viewBox')).toBe('0 0 32 32')
  expect(svg.getAttribute('width')).toBe('88')
  expect(host.querySelector('.av-injecting')).not.toBeNull()
  expect(svg.querySelectorAll('rect')).toHaveLength(SCENES.reflex.rects.length)
})

test('a child state scene renders from the state table', async () => {
  const { host } = await render(<Avatar state="BLOCKED" size={30} />)
  expect(host.querySelector('.av-blocked-state')).not.toBeNull()
  expect(host.querySelector('svg')!.getAttribute('width')).toBe('30')
})

test('it is decorative: the caption beside it carries the meaning', async () => {
  const { host } = await render(<Avatar scene="reflex" size={88} />)
  expect(host.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
})

test('rects are classed by part and numbered within that part', async () => {
  const { host } = await render(<Avatar scene="dispatch" size={88} />)
  // dispatch lists its three children last, but they must still number 0,1,2
  // so the CSS stagger reaches them.
  expect(host.querySelectorAll('.av-object-0')).toHaveLength(1)
  expect(host.querySelectorAll('.av-object-1')).toHaveLength(1)
  expect(host.querySelectorAll('.av-object-2')).toHaveLength(1)
  expect(host.querySelector('.av-object-11')).toBeNull()
})
