# whisper-rs-sys 0.15.0, on whisper.cpp 1.9.5

`src-tauri/Cargo.toml` swaps this directory in for crates.io's `whisper-rs-sys` with
`[patch.crates-io]`. `whisper-rs` 0.16 (the latest on crates.io, from 2026-03-12) depends on
`whisper-rs-sys` 0.15, which bundles whisper.cpp 1.8.3. Nothing newer has been published.

## Why

Measured on 2026-10-16 on Apple Silicon (Metal). The input was a 3 min 34 s Portuguese voice
note, with `ggml-large-v3-turbo-q5_0`, using the app's own decode parameters. The two builds ran
alternately, so each pair saw the same load:

| whisper.cpp | transcribe (s), 3 runs |
|---|---|
| 1.8.3 (crates.io) | 24.1, 25.0, 27.0 |
| 1.9.5 (this directory) | 15.1, 15.4, 15.7 |

The transcript was the same length on both: 547 words.

The upstream CLI shows the same gap. It was run as
`whisper-cli -m <model> -t 8 -mc 0 -bs 1 -bo 1 -tpi 0.4 -l pt -nt -np -f note.wav`:

- v1.8.3, built from its tag with `-DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON`: 13.2 s and 15.0 s.
- v1.9.5, from Homebrew: 7.1 s and 7.2 s.

The app's decode parameters were ruled out by turning each one off in turn: the token budget,
temperature fallback and `suppress_nst`. Each change stayed within run-to-run noise.

## What is here

- From crates.io's `whisper-rs-sys` 0.15.0, verbatim: `wrapper.h` and `src/`. Also its
  normalized `Cargo.toml`, with one line changed: `include` lists `whisper.cpp/include/*.h`,
  because 1.9.5 adds `parakeet.h`.
- `build.rs` comes from the same crate with one change. `get_whisper_cpp_version` also reads
  1.9.5's `set(WHISPER_VERSION_MAJOR|MINOR|PATCH …)`. The old reader only knew
  `project("whisper.cpp" VERSION …)`, and the build panicked without a version.
- `whisper.cpp/`: upstream tag `v1.9.5` (commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`),
  verbatim. It holds the same paths the crate's `include` list ships. Of
  `ggml/src/ggml-*/`, only the backends this app can build are kept: `ggml-cpu` (every
  platform), `ggml-metal` (macOS), `ggml-blas` (on by default on Apple) and `ggml-vulkan`
  (Windows). ggml adds a backend's directory only when that backend is enabled, so the others are
  never read. To build one, put its directory back first (cuda, …).
- One line of `whisper.cpp/` is not upstream's: `ggml/src/ggml-vulkan/CMakeLists.txt` builds its
  shader generator in `<build>/vsg` (`BINARY_DIR`). In the default
  `<build>/ggml/src/ggml-vulkan/vulkan-shaders-gen-prefix/src/vulkan-shaders-gen-build`, under
  a Cargo `OUT_DIR`, the paths MSBuild writes for its compiler check pass Windows' 260
  characters (271 in `~/.cache/<target>`, 277 on the CI runner), and the build stops at
  `FTK1011`.

## Updating

```sh
git clone --depth 1 --branch vX.Y.Z https://github.com/ggml-org/whisper.cpp /tmp/w
V=src-tauri/vendor/whisper-rs-sys/whisper.cpp
rm -rf "$V" && mkdir -p "$V/ggml/src"
(cd /tmp/w && rsync -a --relative bindings/javascript/package-tmpl.json bindings/CMakeLists.txt \
  CMakeLists.txt cmake src include ggml/cmake ggml/CMakeLists.txt ggml/include LICENSE "$OLDPWD/$V/")
rsync -a --exclude='ggml-*/' /tmp/w/ggml/src/ "$V/ggml/src/"
for b in ggml-cpu ggml-metal ggml-blas ggml-vulkan; do rsync -a "/tmp/w/ggml/src/$b" "$V/ggml/src/"; done
```

Then put back the `BINARY_DIR ${CMAKE_BINARY_DIR}/vsg` line in `vulkan-shaders-gen`'s
`ExternalProject_Add` (`ggml/src/ggml-vulkan/CMakeLists.txt`).

Then run `cargo test --lib` and `voice::tests::bench`. A Cargo target that already built this
crate keeps its old copy of the sources in `OUT_DIR`, because `build.rs` copies them only when
none is there. Run `cargo clean -p whisper-rs-sys` first.

## Removing

Once a `whisper-rs` release bundles whisper.cpp 1.9.x or later, delete this directory and the
`[patch.crates-io]` entry, and bump `whisper-rs`.

## Licenses

whisper.cpp is MIT (`whisper.cpp/LICENSE`). whisper-rs-sys is Unlicense.
