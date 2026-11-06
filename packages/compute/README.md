# Rust compute

CPU kernels shared by the desktop core and React renderer. Rust compiles to one
WebAssembly module embedded in the JavaScript bundle. End users need neither Rust
nor a platform-specific native addon. No network request loads executable code.

Build prerequisites are Node 20+, pnpm, and the toolchain pinned in
`rust/rust-toolchain.toml`:

```sh
rustup toolchain install 1.99.1 --profile minimal --target wasm32-unknown-unknown
pnpm install
pnpm --filter @vibisual/compute build
pnpm --filter @vibisual/compute test
pnpm build
```

`build.mjs` checks source fingerprints, compiles the crate, validates its Wasm,
and embeds it into generated TypeScript. Generated artifacts are not committed.
`VIBISUAL_RUST_CARGO` can select a Cargo executable in an isolated toolchain.
CI and release jobs install the same pinned compiler and target on all platforms.

The Rust crate owns numerical processing and bulk data algorithms. TypeScript
adapters preserve UI objects, localization, persistence guards and transport.
Adapters use eight-byte-aligned buffers and must reacquire views after a Wasm
call that can grow memory. Test the real compiled binary against established
behavior, including empty input, ties, malformed values and Unicode. Measure
packing and result-copying costs together with the kernel.

Keep public entry points in `src/index.ts`. Add new kernels to the Rust crate,
extend the versioned ABI in `src/runtime.ts`, and keep compatibility tests next
to the consuming adapter. Build failure must never silently replace Rust with
a JavaScript implementation.

Current execution boundaries:

- Image color distances, contiguous color-key flood fill, alpha flattening,
  transparency checks and trim bounds use Rust. The editor runs them in a
  dedicated worker with an immutable source and distance cache in Wasm memory.
  Undo buffers are copied before transfer. Superseded previews are ignored, and
  closing or changing the source terminates the worker. A repeated synthetic 4K
  contiguous key measured 122.13 ms in JS versus 44.39 ms including the production
  worker round trip; initial source copying took 7.61 ms. Canvas IO is excluded.
  Reproduce with `node packages/compute/bench-image.mjs`.
- Procedural material maps use Rust in a worker for UI previews and editing.
  Seeded color, normal, roughness and AO bytes match the previous generator.
  Transactions await all maps before history, saving or rendering the result;
  dependent architectural dirt atlases also run in Rust after their base maps.
  Existing saved texture blobs stay authoritative. GPU drawing stays in Three.js.
  A 1024-square concrete bake measured 1026.82 ms in JS versus 310.15 ms including
  the production worker round trip. GPU upload is excluded. Reproduce with
  `node packages/compute/bench/material.mjs`; test the dependent atlases with
  `node packages/client/bench/surfaceWear.mjs`.
- Video raw BGRA/RGBA conversion uses Rust in the existing hidden work renderer.
  Opaque native VideoFrame conversion and native codecs remain in place. An
  exact-size ArrayBuffer can transfer without another copy; pooled buffers and
  subarrays must first be isolated. On Windows Node 22, semi-transparent 4K
  conversion measured 69.431 ms in JS versus 16.700 ms through Rust, including
  both Wasm copies. Capture, Electron IPC, GPU and encoding are excluded.
  Reproduce with `node --expose-gc packages/video/bench/rawFrame.mjs` after building
  compute and video.
- Bundle interior geometry runs in a dedicated renderer worker. Ordered radii,
  caption widths and host trigonometric values cross the boundary as f64 arrays;
  IDs and UI objects remain in TypeScript. The compiled Rust coordinates match
  the JavaScript test reference exactly. A 120-member cold page measured
  1,430.4 ms in the reference, 72.6 ms with the Rust copy boundary, and 73.7 ms
  including a worker round trip. Main-thread packing and result mapping took
  0.4 ms. Unchanged layouts are cached, concurrent identical requests share one
  job, and obsolete page results cannot replace the current view.
- Satellite return-path checks and stream indexing run synchronously because
  their result belongs to the current physics step or render. Keep their
  boundary-inclusive cost within the frame budget; larger future jobs belong in
  workers with stale-result protection.
- Checkpoint serialization stays in V8's native `JSON.stringify`, with Node's
  native SHA-1. A byte-identical Rust visitor was measured on nine real projects:
  serialization plus hashing took 199.51 ms versus 136.89 ms with V8 because of
  JS object traversal and string-copy boundaries. Keep this measured exception;
  a future Rust data model must remove the boundary cost before replacing it.
  Coordinate saves instead skip unchanged data and save only changed projects.
- The server retains synchronous validation and serialization before its
  existing disk-write worker, preserving immediate-save guards, retry ordering
  and shutdown flush. Moving live checkpoint objects to a worker requires a
  separately measured immutable snapshot protocol; cloning is not free.
- UI text, localization and small formatting operations remain with
  React/TypeScript.
