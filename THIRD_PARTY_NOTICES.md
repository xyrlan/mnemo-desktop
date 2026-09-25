# Third-party notices

mnemo-desktop ports parts of the following software. Each file adapted from it
says so on its first line (`// adapted from stablyai/orca <path>`), or, for a
stylesheet section, in the comment that opens it.

## Orca

https://github.com/stablyai/orca, at commit
`122b8c25d7c16f76e395bf9a65887d7c4bc5003b`.

Used for:
- the design tokens and the sleek scrollbar in `src/theme.css` (from
  `src/renderer/src/assets/main.css`);
- the UI primitives in `src/ui/` other than `kbd.tsx` and `cn.ts` (from
  `src/renderer/src/components/ui/`);
- the screens of the redesign's waves B to E — among them `src/shell/`, `src/sidebar/`,
  `src/tabs/`, `src/layout/SplitView.tsx`, `src/chrome/`, `src/statusbar/`, `src/rightbar/`,
  `src/dashboard/`, `src/jump/`, `src/new-workspace/`, `src/notify/`, `src/pet/`,
  `src/onboarding/`, `src/diff/`, `src/commit/`, `src/floating/`, `src/quick-commands/`,
  `src/voice/`, `src/browser/`, `src/explorer/`, `src/search/`, `src/source-control/`,
  `src/checks/`, `src/chat-input/`, `src/conversation/`, `src/vault/`, `src/home/`,
  `src/tasks/` — where a file opens with `// adapted from stablyai/orca <path>`.

```
MIT License

Copyright (c) 2026 Lovecast Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
