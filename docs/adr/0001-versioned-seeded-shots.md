# Shots are rebuilt from versioned seeds, and old generator versions are kept

Shot Links and the Daily don't store a Shot. They store a key (generator version, Table Format, difficulty, seed) and rebuild the Shot in the browser, because GitHub Pages has no server or database to hold shared Shots. The catch is that any change to generation, including a Table Format's dimensions, would silently turn every published link and past Daily into a different Shot. So each generator version is frozen once released. A change to generation ships as a new version alongside the old ones, and the Daily switches to it only from the next day. The `keep generator v1 stable` snapshot test enforces this.

## Consequences

- Fixing an estimated pocket size, such as the UK or Chinese side pocket, means a new generator version that carries the corrected spec. Editing `formats.ts` in place would break old links.
- `mulberry32` and `hashString` in `rng.ts` are part of this contract and must never change.
- The throw model (`physics.ts`: TP A.14's equations, friction fit and Stroke speeds) decides which Choice is correct from generator v2 onward, so it is part of this contract too.
