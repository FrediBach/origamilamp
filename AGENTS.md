# Working in Origami Lamp

Read [docs/architecture.md](docs/architecture.md) for data flow and module contracts, [README.md](README.md) for setup and product behavior, and the relevant parts of [docs/OrigamiLampAgentBrief.txt](docs/OrigamiLampAgentBrief.txt) when changing manufacturing. The brief includes future ideas; verify implemented behavior in the code.

## Development workflow

- Use Node.js >=22.12.0 and npm with the committed `package-lock.json`; install with `npm ci`.
- Keep changes focused. Follow the existing TypeScript style: two-space indentation, single quotes, no statement semicolons, type-only imports, and `@/` imports across `src` directories. Avoid unrelated formatting or dependency changes.
- Keep domain calculations and validation in `src/lib/`; `App.tsx` coordinates state and `components/studio/` composes the UI. Reuse existing helpers before adding parallel calculations.
- Keep parameter updates immutable. React memoization and text-projection caches depend on object identity.
- Update architecture/product documentation when behavior or module contracts change. Do not commit `dist/`, `node_modules/`, `*.tsbuildinfo`, or browser test artifacts.

## Contracts to preserve

- **Print and preview are separate representations.** `buildManufacturingGeometry` supplies both manufacturing views and exports: millimetres, XY-centered, Z-up, assembly bottom at zero. Preserve each part's registered elevation. `buildExpandedGeometry` is an approximate metre-scale, Y-up surface. Never export it or apply viewer transforms to STL vertices.
- Preserve integer-layer Z boundaries, alternating inner/outer TPU joins, an open aperture, valid closed material boundaries, non-overlapping material interiors, and one removable PLA component per separator. The combined permanent TPU must retain the connected shade. Use true contour offsets, not scaled washers.
- Keep polygon, twist, and modulation export-blocked until their manufacturing construction is implemented and verified. Enforce gates in the generator as well as the UI.
- Pattern cutouts retain TPU; they are not through-holes. Keep their remaining-layer count, alternating recess face, cadence/phase, terminal-sheet protection, and outside removal path consistent across geometry, optics and inspectors.
- Lettering partitions existing TPU volume into base/accent parts; it must preserve PLA, both joining bands, and terminal membranes. Target `height` affects printed lettering; preview `expansion` and `rotation` do not. Preserve shared STL registration.
- Treat diagnostic IDs as contracts used by parsing, corrections and UI; review the layer inspector's `BLOCKING_CHECKS` when adding geometry errors. Corrections must revalidate other constraints and preserve printer limits, source requirements and measured calibration inputs.
- Hardware and lighting remain separate preview concepts. Do not claim physical release, folding, load, thermal or electrical validation from software tests. Keep unperformed physical acceptance explicitly pending.

## Changing saved settings or UI

- For a saved setting, update `LampParameters`, `DEFAULT_PARAMETERS`, `validateLamp`, relevant controls/calculations, recipe metadata and tests together. Review the parser's scalar-error set when adding scalar diagnostics.
- Preserve schema-version-1 imports. Add a new defaultable field to `OPTIONAL_V1_SETTINGS` intentionally; only absent fields receive defaults. Explicit nulls, invalid types and unsupported values must still fail. Test round trips, missing older fields and invalid explicit values.
- Use `ParameterControl` and the existing Radix-based UI components. Preserve draft/commit behavior, accessible units, slider/keyboard parity, dialog focus restoration, mobile layout and WebGL fallback. Suggested control ranges must not silently truncate valid imported recipes.

## Rendering changes

- Preserve demand rendering. Animate by updating existing light/material uniforms and invalidating only when needed; do not rebuild geometry or set React state on each flicker frame. Keep hidden/offscreen suspension and bounded shadow refinement.
- Dispose explicitly allocated Three.js geometry/textures and clean up timers, observers and patched material hooks. Include new dependencies in geometry/optical/shader cache keys without tying expensive work to unrelated intensity or warmth changes.
- Preserve nominal `cutoutCoord` / `cutoutJoin` attributes and the print-Y/negative-viewer-Z mapping used by text and optics.
- Three.js shader patches depend on shader source structure. Changes to them or dependency upgrades require shader tests plus browser checks for actual rendered output and console errors.

## Verification

- Run focused Vitest tests for changed logic, e.g. `npm test -- src/lib/lamp.test.ts`. Geometry tests should inspect output topology, volume, layer/material occupancy and export alignment rather than merely repeat implementation formulas.
- For code changes, run `npm run typecheck` and the relevant tests. Run `npm test` for shared geometry, validation or recipe changes; run `npm run build` for application/build/dependency changes and `npm run doctor` for React changes.
- Run relevant Playwright specs for UI, rendering or browser I/O changes, e.g. `npm run test:e2e -- tests/studio.spec.ts`. Playwright starts Vite on port 5174; install Chromium with `npx playwright install chromium` or use `PLAYWRIGHT_CHANNEL=chrome`. Include accessibility/focus checks for interactions and visible-output checks for rendering.
- Scripts are defined in `package.json`; there is no `npm run lint`. Docs-only changes need link/content review and `git diff --check`, not a full application test run.
- Report what changed, which checks ran, and any remaining limitation. Distinguish software verification from slicer or physical acceptance.
