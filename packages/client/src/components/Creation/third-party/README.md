# Bundled 3D decoders — third-party licenses

`../modelDecoders.ts` loads these decoders only when a glTF file uses the matching compression. They are the copies
three.js ships in `examples/jsm/libs`; Vibisual does not modify them.

| Decoder | Files | License | Text |
|---|---|---|---|
| Draco (Google) | `draco/draco_wasm_wrapper.js`, `draco/draco_decoder.wasm` | Apache-2.0 | [LICENSE-draco.txt](LICENSE-draco.txt) |
| Basis Universal (Binomial) | `basis/basis_transcoder.js`, `basis/basis_transcoder.wasm` | Apache-2.0 | [LICENSE-basis-universal.txt](LICENSE-basis-universal.txt) |
| meshoptimizer (Arseny Kapoulkine) | `meshopt_decoder.module.js` | MIT | [LICENSE-meshoptimizer.txt](LICENSE-meshoptimizer.txt) |

The studio lighting (`../studioLighting.ts`) uses three's `RoomEnvironment`, part of three.js (MIT).
