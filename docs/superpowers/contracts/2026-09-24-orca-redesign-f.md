---
feature: orca-redesign-f
created: 2026-09-24
verdict: parallel
---

The last step of the Orca redesign (spec, *Delivery*, wave E's closing line): the old stylesheet
scope goes, now that waves B–E have given every screen on the new look. One piece, because it is
one stylesheet and every screen depends on it.

`src/theme.css` still keeps the pre-redesign look alive inside `.app`, `.palette-overlay`,
`.pulse-host` and `.voice-host`: it binds `--accent` / `--border` back to their legacy values,
sets the UI font to JetBrains Mono, and reverts Tailwind's element resets (`revert-layer`) except
under `[data-ui]` / `[data-slot]`. New screens opt out with `data-ui`.

## legacy-look

Remove that scope: the legacy tokens (`--legacy-accent`, `--legacy-border`, `--bg`, `--fg`,
`--fg-muted`, `--bg-elev`, … wherever nothing needs them), the reverts, the monospace UI font
(JetBrains Mono stays for terminals, code and the editor), and the CSS no screen renders any
more. Every screen still on screen must look right afterwards — find the ones still relying on
the old scope (the setup pane, the pulse overlay and toasts, the palette's prompts, the job-log
pane, the voice host, anything else) and move them onto the tokens and `@/ui`. The marketplace,
mission map and ego graph are frozen (spec) and not on screen; they may lose their look but must
still build.

Prove it with the preview harness: shoot every scenario before and after, and say in the PR
which ones changed and why each change is intended. Also: `src/mission/chat.ts` still finds the
chat parts by `import.meta.glob` from before chat-input landed — import them directly and drop
the old reply box it falls back to; and delete `vendor/orca/`, which was wave E's scaffolding
(THIRD_PARTY_NOTICES keeps naming the adapted folders — add `src/checks/`, `src/chat-input/`,
`src/conversation/`, `src/mission/`, `src/vault/`, `src/learned/`, `src/home/` if they carry
Orca's header).

- **files:** src/theme.css, src/theme.ts, src/**/*.css, src/setup/, src/pulse/, src/palette/, src/cockpit/, src/voice/, src/mission/chat.ts, src/mission/rows.tsx, src/mission/view.test.tsx, vendor/, THIRD_PARTY_NOTICES.md, tools/preview/
- **effort:** xhigh
