import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { editor as MonacoEditor } from 'monaco-editor'
import { store, useApp } from '../layout/app-store'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register } from '../actions/registry'
import { detectPlatform } from '../actions/keys'
import { cssVar } from '../theme'
import { tauriFs } from './client'
import { createSessions } from './sessions'
import { openEditor, registerEditorActions } from './actions'
import { promptPath } from './Prompt'
import { basename, defaultRoot, languageFor } from './paths'
import Tree from './Tree'
import './editor.css'

const fs = tauriFs
const sessions = createSessions()
const platform = detectPlatform()
const modKey = platform === 'mac' ? 'metaKey' : 'ctrlKey'

type Monaco = (typeof import('./monaco'))['monaco']
let monacoLoad: Promise<Monaco> | null = null
const loadMonaco = () => (monacoLoad ??= import('./monaco').then((m) => m.monaco))

function EditorPane({ id, props }: PaneViewProps) {
  const session = useStore(sessions, (s) => s.sessions[id])
  const focused = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.focused === id)
  const host = useRef<HTMLDivElement>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const [editor, setEditor] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const [loading, setLoading] = useState(false)
  const path = session?.path ?? ''
  const dirty = session?.dirty ?? false

  // Session state outlives this component: a split remounts the leaf.
  useEffect(() => {
    const s = sessions.getState()
    if (s.sessions[id]) return
    const root = typeof props.root === 'string' ? props.root : undefined
    s.open(id, typeof props.path === 'string' ? props.path : '', root ?? null)
    if (root === undefined) {
      void fs.home().then((home) => sessions.getState().setRoot(id, defaultRoot(store.getState(), home)))
    }
  }, [id, props])

  const save = async (): Promise<boolean> => {
    const buf = sessions.buffers.get(id)
    if (!buf) return false
    const model = buf.model as MonacoEditor.ITextModel
    const version = model.getAlternativeVersionId()
    try {
      await fs.write(buf.path, model.getValue())
    } catch (e) {
      sessions.getState().setError(id, `Could not save ${basename(buf.path)}: ${e}`)
      return false
    }
    if (sessions.buffers.get(id) !== buf) return false
    buf.savedVersion = version
    sessions.getState().setDirty(id, model.getAlternativeVersionId() !== version)
    sessions.getState().setError(id, undefined)
    return true
  }
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    let ed: MonacoEditor.IStandaloneCodeEditor | undefined
    let cancelled = false
    loadMonaco().then(
      (monaco) => {
        if (cancelled || !host.current) return
        monacoRef.current = monaco
        ed = monaco.editor.create(host.current, {
          model: null,
          theme: 'mnemo',
          fontFamily: cssVar('--font-mono'),
          fontSize: parseInt(cssVar('--font-size'), 10) || 13,
          fontLigatures: false,
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
        })
        ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current())
        setEditor(ed)
      },
      (e) => sessions.getState().setError(id, `Could not load the editor: ${e}`),
    )
    return () => {
      cancelled = true
      // Disposing the editor leaves its model alone; the buffer survives a remount.
      ed?.dispose()
      setEditor(null)
    }
  }, [id])

  useEffect(() => {
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const existing = sessions.buffers.get(id)
    if (!path) return
    if (existing?.path === path) {
      editor.setModel(existing.model as MonacoEditor.ITextModel)
      return
    }
    let cancelled = false
    setLoading(true)
    const drop = () => {
      editor.setModel(null)
      sessions.buffers.get(id)?.model.dispose()
      sessions.buffers.delete(id)
    }
    fs.read(path)
      .then(
        (text) => {
          if (cancelled) return
          const model = monaco.editor.createModel(text, languageFor(path, monaco.languages.getLanguages()))
          const buf = { path, model, savedVersion: model.getAlternativeVersionId() }
          model.onDidChangeContent(() =>
            sessions.getState().setDirty(id, model.getAlternativeVersionId() !== buf.savedVersion),
          )
          drop()
          sessions.buffers.set(id, buf)
          editor.setModel(model)
          sessions.getState().setDirty(id, false)
          sessions.getState().setError(id, undefined)
        },
        (e) => {
          if (cancelled) return
          drop()
          sessions.getState().setDirty(id, false)
          sessions.getState().setError(id, String(e))
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [editor, path, id])

  useEffect(() => {
    if (path) store.getState().setTitle(id, `${dirty ? '● ' : ''}${basename(path)}`)
  }, [id, path, dirty])

  useEffect(() => {
    if (focused) editor?.focus()
  }, [focused, editor])

  // ⌘S outside Monaco (tree, banners); inside it the editor command handles it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (host.current?.contains(e.target as Node)) return
    if (e[modKey] && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
    }
  }

  const st = sessions.getState()
  const root = session?.root ?? null
  const shown = root && path.startsWith(root + '/') ? path.slice(root.length + 1) : path
  const hasBuffer = sessions.buffers.get(id)?.path === path

  return (
    <div className="pane-body editor-pane" onKeyDown={onKeyDown}>
      <div className="editor-head">
        <button
          className={`editor-icon${session?.treeOpen ? ' on' : ''}`}
          onClick={() => st.toggleTree(id)}
          title="Toggle file tree"
        >
          ☰
        </button>
        <span className="editor-path" title={path}>
          {shown || 'no file'}
        </span>
        {dirty && <span className="editor-dirty" title="Unsaved changes">●</span>}
      </div>
      {session?.error && (
        <div className="editor-banner error" role="alert">
          <span>{session.error}</span>
          <button onClick={() => st.setError(id, undefined)}>dismiss</button>
        </div>
      )}
      {session?.pending && (
        <div className="editor-banner" role="alert">
          <span>Unsaved changes in {basename(path)}.</span>
          <button
            onClick={async () => {
              const next = session.pending!
              if (await save()) sessions.getState().navigate(id, next)
            }}
          >
            save
          </button>
          <button onClick={() => st.discard(id)}>discard</button>
          <button onClick={() => st.cancelPending(id)}>cancel</button>
        </div>
      )}
      <div className="editor-main">
        {session?.treeOpen &&
          (root ? (
            <Tree
              fs={fs}
              root={root}
              current={path}
              expanded={session.expanded}
              onToggleDir={(dir) => st.toggleDir(id, dir)}
              onOpen={(p, split) => (split ? openEditor(store, p, root, 'split-row') : st.navigate(id, p))}
              modKey={modKey}
            />
          ) : (
            <div className="editor-tree" />
          ))}
        <div className="editor-code">
          <div ref={host} className="editor-monaco" />
          {!hasBuffer && !session?.error && (
            <div className="editor-empty">{loading || !editor ? 'loading…' : path ? '' : 'pick a file from the tree'}</div>
          )}
        </div>
      </div>
    </div>
  )
}

registerPaneView('editor', EditorPane)
registerEditorActions({ app: store, sessions, fs, prompt: promptPath, register })

// Closing a pane drops its session and disposes its Monaco model.
store.subscribe((s, prev) => {
  if (s.panes !== prev.panes) sessions.getState().prune(Object.keys(s.panes).map(Number))
})
