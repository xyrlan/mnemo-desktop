import type { editor as MonacoEditor } from 'monaco-editor'

/**
 * What saving `model` writes. Monaco takes a UTF-8 BOM off the text it builds a model from and
 * gives it back only when asked: a file is saved with the BOM it was opened with, and without
 * one it did not have. (Windows PowerShell 5.1 reads a `.ps1` without one as ANSI.)
 */
export const savedText = (model: MonacoEditor.ITextModel): string => model.getValue(undefined, true)
