# Redesign concepts

Three directions for a new mnemo-desktop, each a page the maintainer opens and clicks on his
own machine's data. He picks one (or parts of several); nothing here ships.

    python capture.py          # this machine's sessions -> data.js (gitignored)
    python sample.py           # the synthetic capture   -> data.sample.js (committed)
    python check.py            # the two have one shape
    python shot.py console/index.html out.png          # look at a page without a browser window

Open `console/index.html`, `orbit/index.html` or `score/index.html` from disk. Each has a
`BRIEF.md` saying what the direction is, and after it is built a `NOTES.md` saying what was
decided, what is faked and what it would need.

## What the maintainer asked for

The current app works, and he finds it heavy: sessions are hard to tell apart and to move
between, and the presentation is below what the product does. He asked for a drastic change,
not a repaint, and for something that impresses him on sight. In his words, organised:

1. Sessions easy to see, tell apart and navigate. A parent session is recognisable at a
   glance: which project, what it is doing, which children it dispatched, what it wants from
   him. Reading, answering, approving and opening the terminal cost the fewest clicks.
2. A more fluid workflow: fewer screens and modes, continuity between seeing, answering and
   dispatching.
3. A black visual identity.
4. Token and context counts done properly: spent per session, per tree (a parent and its
   children) and per account; how full the context is; how much of the plan is left.
5. The memories each session read, from mnemo (rules injected or read over MCP) and from
   Claude Code itself (`MEMORY.md`, memory files, `CLAUDE.md`).
6. What a session is seeing and making, without opening its terminal and scrolling:
   artifacts, pages, searches, files.
7. Something new that only mnemo with Claude Code can show.

## What is wrong today, measured on his screen and in the code

- **Thirteen parent sessions drawn as thirteen copies of one sprite.** Identity is a label
  cut after two lines, and a drawer tab cut at 14 characters, about two short words. What a
  session is doing shows for one or two per repo; the rest need a hover.
- **The screen is built around children, and most of his sessions have none.** On a 2560×1440
  window, 12 of 13 parents sat in a strip at the bottom while the rooms above were empty and
  about half the canvas was blank.
- **No way to move between sessions from the keyboard on Windows.** No next, previous or
  most-recent key; tabs sit in the order they were opened.
- **A parent and its children are tied by one of eight repeating glyphs** and a hover. A
  parent's drawer lists none of its children.
- **A parent's own question cannot be answered from the pending list**, and the list shows at
  most two blocked children with their choices.
- **Model, context, rules, stop, merge and open-PR hide behind a hover or a right-click.**
  Windows are modal, one at a time, and cover the terminal.
- **Tokens:** a fleet-wide rate and the last call's context, nothing else. No total per
  session or per tree, no account on a session; the totals that exist skip cache writes and
  every sub-agent.
- **Memory:** a badge that counts since the app started; the window is per repo, never per
  session. Claude Code's own memory is not read at all.
- **Activity:** the last tool call only.

## Rules every concept keeps

**It is one static folder.** `index.html` plus its own CSS and JS, no build step, no package
install, nothing fetched from the network at run time. It opens from `file://`. It loads
`../base/base.css` and `../base/load.js` and draws `MNEMO_READY`'s data, shaped as `DATA.md`
says. It must draw the real capture (`data.js`) and the sample (`?data=sample`) without an
error in the console; lists that are empty on one are full on the other.

**It is used, not looked at.** Selecting a session, moving between sessions from the keyboard,
answering a pending question, approving a merge, opening a session's terminal view, and
reading its tokens, context, memory and activity all work. Answers and approvals change the
page's own state and nothing else: a prototype never reaches a real session.

**Every state has a URL.** The view is read from, and written to, `location.hash`, so
`shot.py` can photograph any state and a reviewer can be sent to it.

**The maintainer's screen is 2560×1440,** and that is the size to compose for. It also holds
at 1920×1080 and stays usable at 1366×768.

**Identity.** Black ground, near-monochrome, colour only as a signal (`base/base.css` has the
state hues and the three typefaces). The reference he gave is https://saturnspoofer.com/:
pure black, sparse stars, thin white line art around one central piece, wide uppercase
display type with a soft white glow, pills and fine outlines, restrained motion. It is a
mood, not a template: nothing of it is copied (no planet, no logo, no text), and he gave
total freedom to do better. mnemo needs its own central piece; mnemo is memory.
A session's state reads without colour: shape, word or motion carries it too.
A terminal, a diff and a paragraph stay readable for hours: display type is for names and
numbers, never for sentences.

**Motion.** It is part of the brief: this has to feel alive. It also sits beside builds and a
speech model on the GPU all day, so nothing animates on the main thread while nothing is
changing: no `requestAnimationFrame` loop that runs at rest, canvas work stops when the page
is hidden, and CSS animation is preferred to script. A visible switch reduces motion
(`mnemo.motion("reduced")`), and `prefers-reduced-motion` does the same.

**Generated art comes later.** The app's signature pieces (the central piece, loops, session
figures) will be generated with Higgsfield once the maintainer approves a list. A concept
draws its own stand-ins in CSS, SVG or canvas, marks each with `data-asset="<name>"`, and
lists in `NOTES.md` what it would have generated in its place: what it is, where it sits,
still or loop, size.

**Interface text is English.** The data is whatever language the sessions spoke.

**This repository is public.** `data.js` and `shots/` are gitignored and stay that way. Every
image committed or attached to a pull request is taken with `?data=sample`. No real project
name, prompt or home path goes into a file, a commit or a PR body.

**Checking it.** There is no unit suite for a prototype and none should be invented: the
repo's `pnpm test` does not reach this folder, so do not install dependencies to run it.
The check is `python check.py`, then `python shot.py` on each state of the page, on both
captures, at 2560×1440 and 1366×768, with no console error, and then looking at the
pictures (the Read tool opens a PNG). Look at them the way he will: is it striking, can each
session be told from the next, is anything cut off, overlapping or empty. Iterate until it
is. Commit the sample-data screenshots of the main states under `<concept>/shots-sample/`.

**Publishing.** The dispatch prompt asks for the full test suite before publishing: for a
piece in this folder that suite is `python check.py` and the screenshot pass above
(`pnpm test` covers `src/`, which no concept may touch). Open the pull request against the
branch `redesign/concepts`, not `main`, with the sample-data screenshots in its body.
