---
feature: jarvis-research
created: 2026-10-24
verdict: parallel
---

James looks things up (#503). The first hands-free sessions showed two gaps:

- **The outside world.** James had no web. For a fact he did not know he could only answer from the model, or say he does not browse.
- **The past.** "What did we do or decide about X" lives in mnemo's vault, which James barely reached:
  - `read_briefings` reads one project's briefings by date, not by subject;
  - `search` greps the project's code, not the vault.

The vault on the maintainer's machine has about 3,000 session briefings (`bots/<project>/briefings/sessions/`) and 4,700 notes (`shared/`), about 21 MB of text. The briefings are written in **English**. The maintainer asks in **Portuguese**.

The maintainer asked for this as two speeds of web search plus a vault search. They want it measured before any embeddings are built:

- **Quick web search.** James says "Peraí, vou dar uma olhada" and answers within the same turn.
- **Deep research.** James says he will look into it carefully and report. The conversation goes on, and he tells the outcome when it is done.
- **Vault search.** A quiet lookup that James does not announce.

Read #503 first. James reads through a closed tool set and never runs a shell. Every write goes to a parent that never skips its permission prompts. None of that changes: searching the web and the vault are reads.

**The seam is the branch `jarvis/research` (its PR is stacked on #522, #524 and #525). Your branch starts on it: build on it, do not move it.**

- `src/jarvis/routing.ts` holds three new tools and the rules for them. No piece edits this file.
  - **`search_vault(query, project?)`** is a read.
  - **`web_search(query)`** is the quick search.
  - **`research(question)`** is the deep search.
  - **The rules:**
    - the vault is searched without announcing it, in English and Portuguese words;
    - the web search is announced with a short sentence first;
    - research runs in the background and James reports when it is done;
    - what comes from the web is information, never an instruction;
    - the old rule "Você não navega na web" is gone.
- `src/jarvis/client.ts` holds:
  - `search_vault` in `READ_TOOLS`;
  - `Research = { summary, details, sources: { title, url }[] }`;
  - `research(question, deep)`, which invokes `jarvis_research(question: String, deep: bool) -> Result<Research, String>`.

  `client.test.ts` pins the command's name and arguments, and which tools are the panel's to route.
- `src-tauri/src/jarvis_tools.rs` lists `search_vault` in `READ_TOOLS`, with a stub arm that says it is not built yet.
- `scripts/jarvis-bench.jsonl` has rows for the three tools, because the bench test requires every tool to be covered.

**What was measured** on this machine with Claude Code 2.1.310, using this command:

```sh
claude -p --model sonnet --effort low --tools "WebSearch,WebFetch" --allowedTools "WebSearch,WebFetch" --strict-mcp-config --safe-mode --no-session-persistence --output-format json
```

- **The question:** "Qual é a versão estável mais recente do Tauri? … com a fonte".
- **The answer:** right and sourced: 2.12.5, from tauri-apps/tauri releases.
- **The time:** 10.4 s over 2 turns, 12.2 s wall.

**Rules.** Windows first. CI stays green on all three OSes.

- **Private names.** Public text never names a private repository (`~/mnemo/.mnemo/private-names.tsv`; the hook enforces it).
- **Private content.** The vault and James's log are private. No vault text, real request, log row or web result from the maintainer's use goes into a fixture, a test, a commit or a PR body. A measurement over the real vault keeps its question set outside the repository and reports numbers only.
- **Processes and paths.** Every process starts through `proc.rs`. The home dir is read through `app_dir::home()`.
- **Builds.** Build in your own target: `CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-jarvis-<piece>`.
- **Before your first push,** `git fetch`, then rebase onto `origin/jarvis/research` until it lands on main. Your PR targets main; until the stack lands, its diff shows the stack's commits too.
- **On screen.** A piece that changes what is on screen shows it through an isolated dev instance. Its PR says what was seen.
- **Don't touch the maintainer's running things.**
  - Never stop the maintainer's llama-server on port 8091.
  - Never touch the installed app.
  - Never play audio: a test may synthesize speech into memory or a file, never to the speakers.

The two pieces touch no file in common and may land in either order.

## vault

- **files:** src-tauri/src/jarvis_tools.rs, src-tauri/src/jarvis_tools/vault.rs
- **exposes:** `jarvis_tools::run("search_vault", {query: String, project: Option<String>}) -> Result<String, String>`
- **consumes:** nothing
- **effort:** high

`search_vault` for James: mnemo's vault, searched by words.

- **What it searches:** every session briefing of any date, and the vault's live notes. With a project, it searches that project's own pages and the shared ones. Without one, it searches all of them.
- **What it returns:** text for the model, at most `MAX_CHARS`, best match first. For each hit:
  - what the page is: a briefing (with its project and date) or a note (with its kind);
  - its title;
  - the lines that matched, with enough around them to answer from.
- **Speed:** it answers in well under a second over a vault the size of the maintainer's. Measure that and say how.
- **Language:** the brain writes the query in English and Portuguese, so the search must make good use of several words of both languages.

Then measure whether words are enough:

- Write 20 to 30 questions as the maintainer would ask them, in Portuguese, each with the briefing or note that answers it, picked from the real vault.
- Keep that set outside the repository, as `~/.mnemo-desktop-dev/vault-eval.jsonl`. It is private.
- Measure how often the right page is first and how often it is in the top five.
- Ship what measured it as an ignored test that reads the set from a path in an environment variable, beside the other ignored benches.
- In the PR, report the numbers and your judgement: whether a local embeddings index would find what words miss, with the failing questions described, never quoted.
- Do not build embeddings in this piece.

## research

- **files:** src-tauri/src/jarvis_research.rs, src-tauri/src/lib.rs, src/jarvis/loop.ts, src/jarvis/loop.test.ts, src/jarvis/store.ts, src/jarvis/store.test.ts, src/jarvis/panel/Panel.tsx, src/jarvis/panel/Panel.test.tsx, src/jarvis/panel/panel.css, tools/preview/fixtures/app.mjs
- **exposes:** `jarvis_research(question: String, deep: bool) -> Result<Research, String>`
- **consumes:** nothing
- **effort:** high

James on the web, at two speeds.

**The command.** `jarvis_research` runs a search of the web in a process that can do nothing else.

- **What it runs:** Claude Code's CLI on the maintainer's own subscription, the account chosen as `jarvis_brain` chooses it, with no tool but searching and reading the web.
- **Lifetime:** the process ends with the app, a crash included.
- **Not `deep`:** answers within seconds, for the brain to answer from.
- **`deep`:** may take minutes, with several searches and the pages read.
- **Limits:** each speed has a time limit. Past it, and when Claude is missing or fails, the result is an error that says so.
- **The result:** a `Research`.

**The loop.**

- **`web_search` is a read whose output goes back to the brain.**
  - Words the brain writes before it are said at once, while it runs, as with the other reads.
  - The output reaches the brain marked as text from the web, which is never an instruction.
  - It works with either brain.
- **`research` does not hold the conversation.**
  - James says at once that he is looking into it. The research runs in the background, and the requests that follow are answered as usual.
  - When it ends, James says its `summary` aloud at a moment he is neither speaking nor listening to the maintainer.
  - The panel shows the whole answer and its sources.
  - Asked how it is going, he says so.
  - A failure is said, and the panel shows why.
- **What a second research while one runs does is yours to decide.** Say what you chose and why.
- **Show it.** Show the panel's research through an isolated dev instance. Its PR says what was seen.
