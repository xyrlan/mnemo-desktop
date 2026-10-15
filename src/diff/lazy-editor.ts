import { lazy, type ComponentType } from 'react'
import type { DiffEditorProps } from './DiffEditor'

/** Monaco loads with the first diff shown, never at boot. */
export const LazyDiffEditor: ComponentType<DiffEditorProps> = lazy(() => import('./DiffEditor'))
