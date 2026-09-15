/** Monaco, loaded on first editor mount so the terminal-only boot never pays for it. */
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { cssVar } from '../theme'

self.MonacoEnvironment = {
  getWorker(_id, label) {
    switch (label) {
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  },
}

// The editor has no project context (tsconfig, node_modules), so semantic checks would
// flag every import. Keep syntax errors only.
for (const d of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  d.setDiagnosticsOptions({ noSemanticValidation: true, noSuggestionDiagnostics: true })
}

monaco.editor.defineTheme('mnemo', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': cssVar('--bg'),
    'editor.foreground': cssVar('--fg'),
    'editorGutter.background': cssVar('--bg'),
    'minimap.background': cssVar('--bg'),
  },
})

export { monaco }
