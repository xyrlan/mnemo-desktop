# Generated art

Every picture here was generated with Higgsfield and is bundled with the app; nothing is
fetched at run time. A file not imported by the front is reference only and adds nothing to
the bundle. The two stills the gallery page shows (`src/ds/Gallery.tsx`) are imported by that
page alone, which is a chunk of its own, loaded only when the gallery is asked for.

| file | what it is | model | settings | credits | used |
| --- | --- | --- | --- | --- | --- |
| `lattice-still.jpg` | the centre piece: nested geodesic lattice with spines and nodes | `gpt_image_2_6` | 1:1, 2k, quality high (kept at 1024 px, JPEG) | 2.75 | reference for `src/ds/lattice.ts`, which draws it live; shown beside it on the gallery page |
| `crystal-still.jpg` | the mark: nested memory crystal as a wireframe | `gpt_image_2_6` | 1:1, 2k, quality high (kept at 1024 px, JPEG) | 2.75 | reference for `Mark`, whose shells are measured off it; shown beside it on the gallery page |
| `thread-still.jpg` | a sphere wound from one thread | `gpt_image_2_6` | 1:1, 2k, quality high (kept at 1024 px, JPEG) | 2.75 | reference for James's presence |
| `seed-still.jpg` | a seed head letting seeds go | `gpt_image_2_6` | 1:1, 2k, quality high (kept at 1024 px, JPEG) | 2.75 | not chosen; the motes of memory in flight follow its idea |
| `boot.webm`, `boot.mp4`, `boot-last.jpg` | the boot sequence: a point of light, hairlines drawing themselves into the lattice, the inner shell, the spines, the nodes lighting; four seconds, played once at launch | `seedance_2_5` | 1:1, 720p, 4 s, no audio, the lattice still as the last frame (kept at 640 px, VP9 and H.264; the JPEG is its last frame) | 35 | the frame's launch |
| `james-orb.webm`, `james-orb.mp4`, `james-orb-first.jpg` | James's presence: the thread orb turning, its weave shimmering; a five-second loop | `seedance_2_5` | 1:1, 720p, 5 s, no audio, the thread still as first and last frame (kept at 640 px, VP9 and H.264; the JPEG is its first frame) | 35 | James's panel |

The four stills were candidates for the centre piece, generated on 2026-11-09 from prompts
that asked for one object in ultra-thin white hairlines on pure black, uniform stroke, no
fill, no shading, no text. The lattice was chosen for the centre and the crystal for the
mark, which continues the memory crystal the app already had.

A fifth generation, a five-second loop of the lattice turning (`seedance_2_5`, 720p, 35
credits), came back almost still and is not kept: the lattice is drawn from geometry instead,
so it turns truly, answers to events and costs a few hundred line segments.

Each clip is kept in two encodings because the three systems' webviews do not agree on one:
a `<video>` lists the WebM first and the MP4 second, with the JPEG as its poster, which is
also what reduced motion shows. Spent on Higgsfield for the recreation, in all: 116 credits.
