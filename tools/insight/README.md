# Insight check

Holds the core's session insight (`src-tauri/src/insight.rs`) against the real transcripts of
the machine it runs on. The spec asks that a number match its source
(`docs/superpowers/specs/2026-11-10-recreation-core.md`, "Session insight"); this is what says
whether it does.

```sh
node tools/insight/check.mjs            # the 400 newest transcripts
node tools/insight/check.mjs --n 50     # fewer
node --test tools/insight/              # the check's own tests
```

It reads every account's `projects/` (`~/.mnemo-desktop/accounts.json`), builds the app's test
binary with `cargo`, and takes about a minute and a half for 1.5 GB of transcripts. On Windows
run it from PowerShell, as every `cargo` command here. With a per-piece Cargo target, set
`CARGO_TARGET_DIR` as for any other build.

## What it does

1. Runs the ignored test `insight::probe::real_transcripts`, which reads each transcript with
   the core's own reader and writes what it read to a file in the temp dir. That file names
   real sessions and paths: it is deleted once read (`--keep` leaves it, `--dump <file>` reads
   one that was kept instead of running the probe).
2. Counts the same bytes of the same files with `count.mjs`: every line parsed whole, every
   API message kept in a map, nothing incremental, no code shared with the core.
3. Prints what was measured, and each counter where the two differ. Exit 1 on any difference.

```
400 transcripts, 1564.6 MB, and 98 sub-agent transcripts beside 28 of them
  API messages    38,547, 9,126,445,014 tokens with their caches
  tool calls      36,962
  compactions     111; 161 sessions on the 1M window
  screenshots     356 listed, 0 not read back by id
  read in parts   0 of 400 differ from the same bytes read in one go
  counted again   0 of 400 differ from count.mjs (7.5 s)
  context         against Claude Code's own size at 109 compactions (200,512 to 967,338 tokens): median 0.00%, largest 0.4%
  cost            read at 51 MB/s (a debug build); 20 sessions asked again with nothing new: 1.11 ms
```

- **screenshots**: every screenshot the feed lists is read back through `insight_shot`'s
  lookup and must open as the picture its media type says.
- **read in parts**: each transcript is read once whole and once in three goes cut at a third
  and two thirds of its bytes, mid-line as they fall. The answers must be equal: this is the
  reader picking up where the last call stopped.
- **counted again**: per transcript, the tokens by kind (main chain, side chain, by model,
  each sub-agent, the sum), how many API messages, the context and its window, each
  compaction, the tool calls by kind, turns and their time, screenshots, title, first and last
  time, pull requests and cost.
- **context**: `context.tokens` is the last main-chain call's input, both caches and output.
  Claude Code states the true size only when it compacts (`compactMetadata.preTokens`); this
  is how far the two were apart at each compaction, as `measure_context.py` on
  `redesign/concepts` measures it.
- **cost**: how fast a transcript is read the first time, and what a poll of 20 sessions costs
  when none of them wrote anything.

A difference prints the session's first 8 characters, the counter, and both values. Either the
core or `count.mjs` is wrong about that transcript: find the line that splits them before
changing either.
