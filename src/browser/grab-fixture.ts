import { clampGrabPayload, type GrabPayload } from './grab-payload'

/** A picked Save button, for the tests. */
export function payload(over: { target?: Partial<GrabPayload['target']> } = {}): GrabPayload {
  const base = clampGrabPayload({
    page: { sanitizedUrl: 'http://localhost:3000/settings', title: 'Settings', viewportWidth: 1200, viewportHeight: 800, devicePixelRatio: 2 },
    target: {
      tagName: 'button',
      selector: 'button#save',
      elementPath: 'main > #save',
      textSnippet: 'Save',
      htmlSnippet: '<button id="save">Save</button>',
      accessibility: { role: 'button', accessibleName: 'Save changes' },
      rectViewport: { x: 10.4, y: 20.6, width: 80, height: 32 },
      computedStyles: { display: 'inline-block', position: 'static', color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', width: 'auto' },
    },
    nearbyText: ['Unsaved changes'],
  })!
  return { ...base, target: { ...base.target, ...over.target } }
}
