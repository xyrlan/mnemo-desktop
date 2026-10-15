import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { editor as MonacoEditor } from 'monaco-editor'
import { store, useApp } from '../layout/app-store'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register } from '../actions/registry'
import { detectPlatform } from '../actions/keys'
import { cssVar } from '../theme'
import { tauriFs, type Saved } from './client'
import { createSessions } from './sessions'
import { registerEditorActions } from './actions'
import { registerReuse } from '../layout/reuse'
import { editorShows, keepEditedTabs } from './tabs'
import { promptPath } from './Prompt'
import { basename, defaultRoot, languageFor } from './paths'
import { savedText } from './text'
import './editor.css'
import { norm, relativeTo } from '../path/path'

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

  /** Saves the buffer unless the file changed on disk since it was loaded or last saved (or is
   *  gone), which `conflict` then says; `checked: false` writes whatever is there. Saves run one
   *  at a time, each checked against what the one before it wrote. */
  const save = (checked = true): Promise<boolean> => {
    const buf = sessions.buffers.get(id)
    if (!buf) return Promise.resolve(false)
    const run = async (): Promise<boolean> => {
      if (sessions.buffers.get(id) !== buf) return false
      const model = buf.model as MonacoEditor.ITextModel
      const version = model.getAlternativeVersionId()
      let saved: Saved
      try {
        saved = await fs.write(buf.path, savedText(model), checked ? buf.stamp : undefined)
      } catch (e) {
        sessions.getState().setError(id, `Could not save ${basename(buf.path)}: ${e}`)
        return false
      }
      if (sessions.buffers.get(id) !== buf) return false
      if (saved.status !== 'written') {
        sessions.getState().setConflict(id, saved.status)
        return false
      }
      buf.stamp = saved.stamp
      buf.savedVersion = version
      sessions.getState().setDirty(id, model.getAlternativeVersionId() !== version)
      sessions.getState().setError(id, undefined)
      sessions.getState().setConflict(id, undefined)
      return true
    }
    const next = buf.saving ? buf.saving.then(run, run) : run()
    buf.saving = next
    return next
  }
  const saveRef = useRef(save)
  saveRef.current = save

  /** Makes `model` the pane's buffer for `path`, clean, as loaded from content stamped `stamp`. */
  const adopt = (ed: MonacoEditor.IStandaloneCodeEditor, path: string, model: MonacoEditor.ITextModel, stamp: string) => {
    const buf = { path, model, savedVersion: model.getAlternativeVersionId(), stamp }
    model.onDidChangeContent(() => sessions.getState().setDirty(id, model.getAlternativeVersionId() !== buf.savedVersion))
    ed.setModel(null)
    sessions.buffers.get(id)?.model.dispose()
    sessions.buffers.set(id, buf)
    ed.setModel(model)
    sessions.getState().setDirty(id, false)
    sessions.getState().setError(id, undefined)
    sessions.getState().setConflict(id, undefined)
  }

  /** Replaces the whole text of `model` as one undoable step. */
  const replace = (model: MonacoEditor.ITextModel, text: string) => {
    model.pushStackElement()
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)
    model.pushStackElement()
  }

  /** The file as it is on disk, or null (and the error shown) when it cannot be read. */
  const loadAgain = async (buf: { path: string }) => {
    try {
      const disk = await fs.load(buf.path)
      return sessions.buffers.get(id) === buf ? disk : null
    } catch (e) {
      sessions.getState().setError(id, `Could not read ${basename(buf.path)}: ${e}`)
      return null
    }
  }

  /** Takes the disk's version. The model is built from it as a first load builds one, so its BOM
   *  and line endings are the disk's; the buffer's own text is one ⌘Z back. */
  const reload = async () => {
    const buf = sessions.buffers.get(id)
    const monaco = monacoRef.current
    if (!buf || !monaco || !editor) return
    const disk = await loadAgain(buf)
    if (!disk) return
    const mine = buf.model as MonacoEditor.ITextModel
    const model = monaco.editor.createModel(disk.text, languageFor(buf.path, monaco.languages.getLanguages()))
    const theirs = model.getValue()
    const eol = model.getEOL() === '\r\n' ? monaco.editor.EndOfLinePreference.CRLF : monaco.editor.EndOfLinePreference.LF
    replace(model, mine.getValue(eol))
    replace(model, theirs)
    adopt(editor, buf.path, model, disk.stamp)
  }

  /** Writes the buffer over the disk's version, which stays one ⌘Z back. A further change on
   *  disk in the meantime is caught like the first. */
  const overwrite = async () => {
    const buf = sessions.buffers.get(id)
    if (!buf) return
    const disk = await loadAgain(buf)
    if (!disk) return
    const model = buf.model as MonacoEditor.ITextModel
    const mine = model.getValue()
    // Monaco drops a BOM only when it builds a model; in an edit it would be text.
    replace(model, disk.text.replace(/^\uFEFF/, ''))
    replace(model, mine)
    buf.stamp = disk.stamp
    await save()
  }

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
    fs.load(path)
      .then(
        ({ text, stamp }) => {
          if (cancelled) return
          adopt(editor, path, monaco.editor.createModel(text, languageFor(path, monaco.languages.getLanguages())), stamp)
        },
        (e) => {
          if (cancelled) return
          editor.setModel(null)
          sessions.buffers.get(id)?.model.dispose()
          sessions.buffers.delete(id)
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

  // ⌘S outside Monaco (banners); inside it the editor command handles it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (host.current?.contains(e.target as Node)) return
    if (e[modKey] && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
    }
  }

  const st = sessions.getState()
  const root = session?.root ?? null
  const shown = (root && norm(root) !== '/' && relativeTo(path, root)) || path
  const hasBuffer = sessions.buffers.get(id)?.path === path

  return (
    <div className="pane-body editor-pane" data-ui onKeyDown={onKeyDown}>
      <div className="editor-head">
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
      {session?.conflict === 'changed' && (
        <div className="editor-banner" role="alert">
          <span>{basename(path)} changed on disk since it was opened. Saving was stopped.</span>
          <button title="Take the version on disk; your edits stay one undo away" onClick={() => void reload()}>
            reload
          </button>
          <button title="Save your version; the one on disk stays one undo away" onClick={() => void overwrite()}>
            overwrite
          </button>
          <button onClick={() => st.setConflict(id, undefined)}>cancel</button>
        </div>
      )}
      {session?.conflict === 'gone' && (
        <div className="editor-banner" role="alert">
          <span>{basename(path)} was deleted or moved on disk. Saving was stopped.</span>
          <button onClick={() => void save(false)}>save anyway</button>
          <button onClick={() => st.setConflict(id, undefined)}>cancel</button>
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
        <div className="editor-code">
          <div ref={host} className="editor-monaco" />
          {!hasBuffer && !session?.error && (
            <div className="editor-empty">{loading || !editor ? 'loading…' : path ? '' : 'no file open'}</div>
          )}
        </div>
      </div>
    </div>
  )
}

registerPaneView('editor', EditorPane)
registerEditorActions({ app: store, fs, prompt: promptPath, register })

// `openView('editor', …, 'auto')` shows the tab already holding the file; a preview tab is replaced
// by reuse, which only a clean buffer takes (an edited one is kept, see `keepEditedTabs`).
registerReuse('editor', (id, p) => {
  const s = sessions.getState().sessions[id]
  if (!s || s.dirty || typeof p.path !== 'string') return false
  sessions.getState().navigate(id, p.path)
  return true
}, editorShows(store, sessions))
keepEditedTabs(store, sessions)

// Closing a pane drops its session and disposes its Monaco model.
store.subscribe((s, prev) => {
  if (s.panes !== prev.panes) sessions.getState().prune(Object.keys(s.panes).map(Number))
})
