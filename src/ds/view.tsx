import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { galleryPage } from './flag'

// `App.tsx` imports every `src/<dir>/view.tsx`. The gallery is not a screen of the app: it is
// a page of its own, with a root of its own beside the shell's (so it takes no place in the
// shell's overlay slot), and its code is a chunk loaded only when it is asked for
// (src/ds/flag.ts). A build that is not asked draws nothing and loads nothing.
const Gallery = lazy(() => import('./Gallery'))

if (galleryPage() !== null && !document.querySelector('[data-ds-gallery]')) {
  const host = document.createElement('div')
  host.dataset.dsGallery = ''
  document.body.appendChild(host)
  createRoot(host).render(
    <Suspense fallback={null}>
      <Gallery />
    </Suspense>,
  )
}
