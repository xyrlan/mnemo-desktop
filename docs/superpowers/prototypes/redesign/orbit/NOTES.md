# Orbit: notes

What was decided while building `index.html`, what is faked, and what generated art would
replace. `BRIEF.md` is the direction; `../README.md` the rules.

    orbit/index.html                    this machine's capture (data.js), else the sample
    orbit/index.html?data=sample        the synthetic capture

## Reading the scene

| what you see | what it means |
| --- | --- |
| distance from the centre | attention, in four named bands: needs you, working, your turn, ended |
| direction | the project: a fixed sector, its name on the rim |
| a body's shape | its own state: ◆ needs you, ● working, ▲ ready to merge, ✕ stalled, ○ your turn, a dotted ghost for ended |
| a body's size | what its whole tree has spent (log scale, 200k to 1B tokens) |
| the ring round a body | its context filling up; the ring thickens past 80% |
| moons | its children; a working child circles, the others stand still; one that needs you pings |
| a violet mote | mnemo handing that session a rule (hollow: the session asked for it) |

A body's band is its family's most pressing state, not only its own: a parent that is
working comes into "needs you" when one of its children asks for a permission, has stalled
or has a merge waiting. The body keeps its own shape, and the moon that asks carries the
mark, so the picture says both "this family needs you" and "which one".

Inside a band, distance is time on a log scale: a fresh request is closest and one mnemo
gave up asking about stands at the band's outer edge; a session whose turn ended a minute
ago is nearer than one that has been quiet for a day.

## Decisions

**An ellipse, not a circle.** A circle on a 16:9 window wastes half of it. The orbits are
ellipses that fill the window, read as a tilted plane. Bands are nested ellipses, so a band
is still one named ring.

**A session moves only along its own ray.** A project's bodies are ordered by start time and
each keeps its direction; a change of state moves it in or out and never sideways. Angle is
handed out by how much room a label has there (more at the sides, where the orbit runs
vertically, than at the top and bottom): the project with the most sessions takes the right
side, the second the left, the rest alternate below and above. What this does not do: a
session that starts re-spaces the rays of its own project, and the order of projects follows
the capture's session counts. The product would pin both for the day.

**Every body carries its full title**, placed by a solver (`js/layout.js`), not by hand.
Each label has about 140 candidate places round its body; a cost keeps it off other labels,
off other bodies, off the centre and the rim names, inside the window, beside its own body
and nearer to it than to any other. Twelve greedy orders are tried and the cheapest whole
layout is kept. When full labels cannot all be placed cleanly, they shed their second lines
and the solver runs again. A label that had to stand off gets a leader line.

**What a label says.** Title; state in a word and a shape; project; tree tokens; context;
how long since it moved. Then one of: what waits ("◆ question …", first two lines), or what
it is doing (the running tool call, or its own last words). A family adds a count by state.
The project is repeated in the label on purpose: the two earlier canvases failed on "which
repo am I in", and the rim is far from a body near the centre.

**The centre piece is a seed head.** mnemo is memory; the stand-in is a sphere of fine
filaments, each ending in a point, slowly turning: rules held, and let go one at a time. The
motes are its seeds. It is not a planet and nothing of the reference is copied. The number of
filaments grows with the rule count but is not one per rule.

**Focus is a station, and the scene stays.** Opening a session scales the live scene into
the top-left as a map (the same DOM, transformed, with the focused family lit), beside the
family, the terminal and three readings. `Esc` scales it back, cursor where it was.
`←` `→` walk the ring and `↑` `↓` the family without passing through the scene.

**Pending opens on the body.** `Tab` flies to the next thing that waits and opens its card
where the body's label stands; the choices are number keys. Every kind gets choices: a
question its own options; a permission Allow / Deny; a merge Approve / Not yet; a stall or a
block Continue / Stop (plus the suggested reply when mnemo has one). Answering moves the
body out along its ray. When the last one is answered the band's light goes out, its name
reads "nothing needs you", and a ring crosses the scene once.

**Colour is only a signal.** White on black; the six state hues of `base.css`; violet for
mnemo's memory. Charts are monochrome with direct labels: thin bars, one 2px line, no legend
to decode.

## Keys

| where | key | does |
| --- | --- | --- |
| scene | `←` `↑` `↓` `→` | move the cursor to the neighbour in that direction (the centre is one) |
| scene | `Enter` | open the body under the cursor (or the centre) |
| anywhere | `Tab` / `Shift+Tab` | next / previous thing that waits; in a station the first `Tab` arms the question of the session being read |
| card open | `1`–`9` | answer |
| anywhere | a letter | find a session by part of its name, project, branch or id; `↑` `↓` `Enter` |
| station | `←` `→` | previous / next session round the ring |
| station | `↑` `↓` | through the family |
| station | `1` `2` `3` | context and tokens · memory · sight |
| scene | `Home` | open the centre |
| anywhere | `Esc` | close the card, then leave the station or the centre, then drop the cursor |

Commands are never letters, so that typing a name needs no prefix.

## URL

Everything is in the hash, so `shot.py` reaches any state:

    #c=<short>                 the scene's cursor (c=core for the centre)
    #p=<short>                 the pending card open on that session
    #s=<short>&r=memory        a station, and its reading (context | memory | sight)
    #s=<short>&p=<short>       a station with its question armed
    #vault                     the centre, opened
    #q=<text>                  the finder
    #a=<short>.<n>,…           answers given on this page (choice n, from 0)

Three query switches exist for checking, not for use: `?check` logs
`orbit-check WxH: N bodies, 0 label overlaps, 0 labels on a body, 0 clipped` and throws when
any count is not zero (so `shot.py` exits 1); `?press=Tab,1,@.motion` plays keys and clicks;
`?mote=0.6` holds one mote still on its way, because a headless shot resizes the window as
it captures and that clears motes in flight.

## Motion, and what it costs

- No `requestAnimationFrame` anywhere. The canvas (the stars) is drawn once per window size.
- Everything that loops is a CSS animation of `transform` or `opacity` on an HTML element:
  the centre's two layers turning, its glow, a need's rings, a working body's spark, a
  working moon's orbit. The SVG is static line art; nothing inside it animates, because an
  animated SVG child is painted on the main thread.
- A mote is one Web Animations call on `transform`, started by a timer. The replay is
  finite: the newest 14 memory events, one every 2.6 s, then the timer is gone and the line
  in the bar offers to play them again. At rest no timer is pending.
- A change of state moves a body with a CSS transition; script runs once, on the change.
- Hidden page: animations are paused and the replay stops. The motion switch (in the bar)
  and `prefers-reduced-motion` both stop the loops, the travel and the replay; shape, word,
  colour and position still carry the state, and a need keeps one still ring.

Not measured: the compositor's own cost of looping layers on a 2560×1440 window beside a GPU
workload. The loops are few and small; the product should measure before keeping them all.

## What is faked

- **The motes** replay the capture's `memory.injected` and `memory.read`, compressed in
  time. In the product an event would launch its own mote. A mote flies to the family's
  body, also when the rule went to a child.
- **Answers** change this page only. The state an answer leads to is invented (a question or
  an Allow puts the session to work, a Deny hands the turn back, Approve ends a merged
  child, Stop ends a session). Choices for anything but a question are invented too.
- **The terminal** is drawn from `lastPrompt`, the newest 24 tool calls, `said`, `recap`
  and `detail`; their order on screen is assumed, not read. A reply typed there is kept in
  memory, shown, and lost on reload (it is not in the hash).
- **The plan windows** are the capture's cached reading, not a live one.
- **Times** are shown in the viewer's local time; ages are measured to the capture.
- **In the station's map** bodies are drawn 2.3× so they survive the scale.
- **Sector order** is not remembered between captures.

## Limits found, not solved

- Moons have no names in the scene: a title appears on hover, and the station's family
  lists them. A parent with 12 children shows 12 dots, and more than 14 on a ring start a
  second ring.
- The real capture here (18 bodies) lays out cleanly at 2560×1440, 1920×1080 and 1366×768;
  at 1366 wide it leans on leaders, and in a shorter window (1350×673) on the short labels.
  Some dozens of bodies would need the ended band to collapse into counts; that is not
  built.
- Rim names are obstacles for labels with a soft weight; in the tightest layouts a label
  may touch one.
- Pointer and keyboard only; nothing was done for touch.

## How it was checked

`python check.py` (0 differences), then `shot.py` with `?check` on the scene, every session
× every reading, every pending card (in the scene and in the station), the centre, the
finder, the all-answered scene and a played key sequence (`?press`): 180 states on the two
captures at 2560×1440, and the same without the memory and sight readings at 1920×1080 and
1366×768. 332 runs, no console error, no label collision. Then the pictures were looked at.
`shots-sample/` holds the main states on the sample capture.

The label check was mutation-tested: with the solver's cost for label-on-label overlap, for
leaving the window, or for covering another body removed, with the solver made to take its
first candidate, and with the short-label fallback removed, the `?check` run on the real
capture at 1366×768 exited 1 each time (the fallback one at the 1350×673 the headless window
passes through before its final size). At 2560×1440 that layout has enough slack that only
the first-candidate mutation fails.

## Generated-art wishlist

Each stand-in carries `data-asset`. What would be generated in its place:

| `data-asset` | what it is | where | still or loop | size |
| --- | --- | --- | --- | --- |
| `memory-core` | The central piece: a seed head of light, hair-thin white filaments radiating from a bright core, each ending in a point, turning slowly; a few seeds loosening at the edge. Black ground, alpha. | centre of the scene (about 250 px across at 2560×1440), larger when the centre is opened (about 440 px) | seamless loop, 20–30 s; plus one still for reduced motion | 1024×1024 |
| `starfield` | Sparse stars, a few brighter, no nebula, no colour. | behind everything | still | 2560×1440, or 5120×2880 for larger windows |
| `session-body` | Six small figures in one family, one per state: ◆ needs you, ● working, ▲ ready, ✕ stalled, ○ your turn, a fading ghost for ended. Thin white line, the state's hue as an inner light. They must read at 12 px and at 50 px, and leave room for the context ring drawn round them. | every body and moon | stills for all six; short loops for "needs you" (it beckons) and "working" (it turns) | 128×128, alpha |
| `memory-mote` | One seed in flight: a point of violet-white light with a short tail. | travels from the centre to a body | loop, about 1 s, or a sprite strip | 64×64, alpha |
| `need-band-light` | The faint amber light the inner band carries while something waits: dust on the orbit rather than a flat gradient. | the "needs you" band | still (or a very slow loop) | 2048×1024, alpha |
| `settle-wave` | The ring of light that crosses the scene when the last pending item is answered. | from the centre outward, once | one shot, about 2 s | 2048×1024, alpha |
| `wordmark` | "mnemo" in wide uppercase with a soft white glow. | top-left | still | 600×120, alpha |
