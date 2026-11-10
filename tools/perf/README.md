# Measuring the app

The design sets a budget (`docs/superpowers/specs/2026-11-10-recreation-design.md`, "Motion and
its budget"): at rest, under 2% of one core and under 3% of the GPU; a view change under
100 ms; the front's bundle under 6 MB with the art. These scripts take those numbers. They
read counters and files; none of them starts, stops or changes the app.

| script | measures | where |
| --- | --- | --- |
| `bundle.mjs` | the size of `dist/`, by kind, the largest files, and what only one door leads to | anywhere |
| `rest.mjs` | CPU and GPU of an app's process tree over a stretch of time | CPU everywhere; GPU on Windows |
| `view-change.mjs` | key to the first frame of the new view, and to the end of the movement | the preview harness's Chromium |
| `serve.mjs` | serves `dist/` where a debug core looks for its front, opening where you say | anywhere |

    pnpm exec vite build
    node tools/perf/bundle.mjs
    node tools/perf/view-change.mjs --world sample --motion full
    node --test tools/perf/test/          # the arithmetic of all four

## The app at rest, in the real webview

A dev server's front runs React in development mode and costs several times a release's, so
the front that is measured is the production bundle, served to a debug core:

    pnpm exec vite build
    node tools/perf/serve.mjs --world sample --view orbit        # port 1420
    # start a debug build under a home of its own (its own state dir, never the installed app's)
    node tools/perf/rest.mjs --pid <its pid> --seconds 60 --label orbit

`--world capture` draws this machine's own fleet when `scripts/world-sample.mjs --real` has
written `public/world.capture.json` (it is gitignored and never leaves the machine);
`--world live` leaves the world to the core. A production front refuses `desktop_app_drive`,
so the view is chosen with `--view`, or with the view's key in the window. Leave the window
in front and untouched while `rest.mjs` runs: a covered window is throttled and reads low.

`rest.mjs` sums the whole tree: the core, the webview's browser, renderer and GPU processes,
the helpers. CPU is processor time over wall time, as a share of one core. GPU is what Task
Manager shows per process (the busiest engine type), summed over the tree, mean and peak.

## A change of view

`view-change.mjs` runs `view-change.page.js` in the page: it presses each view's key and reads
the clock at the first frame that has the new view and at the end of the movement between
the two (320 ms by design; none with motion reduced). The same page script can be handed to
a dev build through the desktop MCP (`desktop_app_drive`, `action: "eval"`), which times the
real webview with a development front.

## What was measured for the swap (2026-11-10)

One machine (Windows 11, 32 logical processors, an RTX 4070 Ti SUPER, a 60 Hz display), a
debug core with the production front, the window maximised and in front, the machine's own
capture of its real fleet on screen (`--world capture`), one minute each:

| view | CPU, of one core | GPU, mean (peak) |
| --- | --- | --- |
| Orbit | 24.5% | 2.1% (2.3%) |
| Console | 13.9% | 1.4% (1.5%) |
| Score | 19.5% | 2.6% (2.7%) |

The GPU is within its 3%. The CPU is not within its 2%, in any view. The core itself is under
1%; the rest is the webview's renderer and GPU processes drawing a frame for every refresh of
the display, because something on screen is always animating: the lattice's drawing loop in
Orbit (with it stopped the page's own work falls to a third), the pulse of the state marks in
every view, Score's marching playhead and echoes. A page with nothing animating draws no
frames and costs nothing; one small animation that never ends costs a frame of the whole
window sixty times a second.

A change of view, production bundle, 2560×1440, the sample fleet, in the harness's Chromium:
51 to 65 ms (median, by pair) with motion reduced; 108 to 156 ms with motion full, where the
view being left stays for the 320 ms of the movement. What costs is drawing the arriving view
from nothing: the layout of its new elements and each view's own measuring passes.

The bundle: 16.85 MB in all, of which 13.39 MB is reached only through the code editor the
classic interface's diff opens (`bundle.mjs` says what stands behind a door); everything
else, the new front with its art among it, is 3.46 MB.
