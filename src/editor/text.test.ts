import { describe, it, expect } from 'vitest'
import { savedText } from './text'

describe('savedText', () => {
  // The real Monaco: the BOM is its model's to keep or drop.
  it('keeps the BOM a file was opened with, and adds none', async () => {
    const { editor } = await import('monaco-editor/editor/editor.api.js')
    const bom = editor.createModel('﻿$name = "héllo"\r\nWrite-Host $name\r\n')
    const plain = editor.createModel('héllo\nworld\n')
    try {
      expect(savedText(bom)).toBe('﻿$name = "héllo"\r\nWrite-Host $name\r\n')
      expect(savedText(plain)).toBe('héllo\nworld\n')
      // Typing keeps it: an edit changes the text, not the BOM.
      bom.applyEdits([{ range: bom.getFullModelRange(), text: 'changed' }])
      expect(savedText(bom)).toBe('﻿changed')
    } finally {
      bom.dispose()
      plain.dispose()
    }
  }, 30_000)
})
