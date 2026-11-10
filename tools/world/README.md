# tools/world

`compare.mjs` holds the live world (`src/world/live/`) against the prototypes' capture of the
same machine (`docs/superpowers/prototypes/redesign/capture.py`) and says where they differ
and why. The two read the same sessions by different roads, so they are not expected to be
equal: the report is the list of what each road reads differently, each kind once, with its
reason and the sessions it is seen on.

```sh
node tools/world/compare.mjs --run            # take a capture now, and compare
node tools/world/compare.mjs                  # compare with the capture already there
node tools/world/compare.mjs --world w.json   # the world a running app built
node tools/world/compare.mjs --json           # the comparison itself, not the report
```

`--run` runs `capture.py` (Python 3, `claude`, `mnemo`, and `gh` unless `--no-gh`); it writes
`data.js` and `shots/` beside itself, both gitignored. `--capture <file>` names another capture.

## Three ways to compare

| way | the live world is | it checks |
| --- | --- | --- |
| `compare.mjs` | built here by `buildWorld`, from rows read as the core reads them (`claude agents` on every account, each account's `jobs/*/state.json` and roster) | who is in the world, in what state, under whom, waiting for what. Needs no app. |
| `compare.mjs --world w.json` | the one the app built: in its console, `copy(JSON.stringify(__mnemoWorld.world()))` | the whole road: the core's snapshot, feed and hook events as the app heard them |
| `await __mnemoWorld.compare()` in a dev build's console | the one on screen, against `/world.capture.json` (`node scripts/world-sample.mjs --real` after a capture) | the same, without a file |

In the first way, what only a transcript says (titles, tokens, the last tool call, pull
requests) is taken from the capture itself, standing in for the feed and the core wave's
insight, so those readings agree by construction. It hears no hook event, and it does not
guess a child's parent as the core does (`link_children`) when mnemo recorded none.

## What the report prints

Sessions by their first 8 characters, states, counts and model names. Never a title, a prompt,
a path, a project or an account: it can be pasted into a pull request. A capture itself is
private and stays on the machine.

The reasons are in `src/world/live/compare.ts`, and `src/world/live/compare.test.ts` makes the
same comparison on the synthetic world, where the two must agree on everything but a child's
advisor.
