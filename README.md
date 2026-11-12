# Iris of the Cosmos — coolest-art-01 entry

A single deterministic Node program (`main.ts`, standard library only) that
renders a 1024×1024 PNG: a giant eye floating in deep space, its iris a
swirling galaxy — cyan core, violet-magenta spiral arms, a neon ring around
a black pupil, bold black lid with tapered lashes, on a starfield with soft
nebulae.

- No network, no model calls, no input files: the image is drawn by a small
  software renderer (signed-distance shapes + a hand-written PNG encoder
  with adaptive row filters and zlib).
- Seeded PRNG throughout: two runs write byte-identical `entry.png`
  (verified: sha256 `84e873dcfbe6e7a9685d919f6caab4037d3c63e36532af047630b6311f5a7317`).
- Output: 1024×1024, 8-bit RGB PNG, ~271 KB (limit 1 MiB). Runs in ~5 s
  (limit 60 s).

Run: `MAKEFUN_OUTPUT_DIR=out node main.ts`
