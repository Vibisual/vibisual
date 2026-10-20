# Sign fonts

These unmodified Korean font files are bundled under SIL Open Font License 1.1; each family includes its license. The pinned upstream commit, SHA-256 hashes, and byte sizes are recorded in `manifest.json`.

Nanum Gothic supplies sans 400/700, Nanum Myeongjo supplies serif 400/700, and Black Han Sans supplies the display role. Their five TTF files total 11,260,164 bytes (10.74 MiB). Assets load only when Vibi3D needs a sign; generated outlines and baked image blobs remain in saved documents. No system font or external font service is used.

The MIT `opentype.js` parser supplies the same outlines to flat signs and channel-letter extrusion. OFL fonts and the MIT parser were selected to allow bundling with the free application.
