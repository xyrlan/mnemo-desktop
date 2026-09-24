import React from 'react'
import { Search } from 'lucide-react'
import { store as app, useApp } from '../layout/app-store'
import { useFleet } from '../fleet/store'
import { searchWorktree } from './client'
import { openMatch } from './open'
import { SearchPanel } from './SearchPanel'
import { createSearchStore } from './store'
import { registerPanel, searchRoot } from './wiring'

/** The single live store: the query and its results survive the sidebar closing and opening. */
const search = createSearchStore({ search: searchWorktree })

function LiveSearchPanel(): React.JSX.Element {
  const activeWorktree = useApp((s) => s.activeWorktree)
  const repos = useFleet((f) => f.repos)
  const root = searchRoot(activeWorktree, repos)
  return <SearchPanel store={search} root={root} onOpenMatch={(file, match) => root && void openMatch(app, root, file, match)} />
}

const unregister = registerPanel({ id: 'search', title: 'Search', icon: Search, order: 20, panel: LiveSearchPanel })
import.meta.hot?.dispose(unregister)
