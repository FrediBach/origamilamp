# Origami Lamp

A browser-based studio for designing expandable TPU bellows lampshades. It combines a live appearance study, inspectable compressed TPU/PLA manufacturing geometry, and a calibration-first export workflow. The production domain is **origamilamp.app**; Vercel build settings are included, while domain assignment and DNS are configured separately.

The design language draws on Dieter Rams’ functional clarity and the warmth, spacing, and materials of traditional Japanese interiors. The application runs locally in the browser, with no account or backend requirement.

## Run locally

Use **Node.js 22.12 or newer** and npm. The dependency lockfile is included.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite, normally `http://127.0.0.1:5173`. The development server binds to the local machine by default.

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

`build` runs TypeScript and produces the static site in `dist/`. `preview` serves that production build locally. A static host can serve `dist/`; custom-domain configuration is a separate deployment step.

### Deploy to Vercel

Import the repository into Vercel and select Node.js 22.x or a newer supported version that satisfies `package.json`. The checked-in `vercel.json` selects Vite, installs from the lockfile with `npm ci`, runs `npm run build`, and serves `dist/`. It adds content-type protection, a referrer policy, and immutable caching for Vite's hashed assets. The app has a single page at `/`, so no catch-all rewrite is needed; missing files and unknown paths should return 404.

Assign `origamilamp.app` to the production deployment and configure its DNS in the Vercel dashboard. No application environment variables are required. If the domain changes, update the absolute URLs in `index.html`, `public/robots.txt`, and `public/sitemap.xml`, and recapture the social preview if the branding changes.

Open Graph and Twitter card tags are in the initial HTML so social crawlers can read them without executing JavaScript. `public/og-image.png` is a 1200 × 630 capture of the app, framed to show its controls and live room preview. The web manifest includes standard and maskable PNG icons, with a separate Apple touch icon. The manifest provides app identity and standalone presentation; offline operation is not implemented.

Image assets are committed and require no generation dependencies during deployment. To regenerate the app icons on macOS, run `swift scripts/generate-brand-assets.swift` from the repository root. To refresh the OG image, start the local app and run `node scripts/capture-og-image.mjs http://127.0.0.1:5173` with Playwright Chromium installed, or prefix the command with `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome. The capture script adjusts framing only in its browser session; application styles remain unchanged.

After deployment, check `/robots.txt`, `/sitemap.xml`, `/site.webmanifest`, and `/og-image.png` on the production domain and verify a shared link's preview. Vercel configuration reference: [static configuration](https://vercel.com/docs/project-configuration/vercel-json).

For browser integration and accessibility checks, install Playwright’s Chromium once, then run the browser suite:

```sh
npx playwright install chromium
npm run test:e2e
```

On macOS, an existing Chrome installation can also be used with `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`.

Use `npm run test:watch` while changing the geometry engine. Browser tests are separate from the Vitest geometry tests and require a working Chromium/WebGL environment.

## Stack

The initial dependency ranges in `package.json` are React **19.3.1**, Vite **8.3.4**, TypeScript **5.9.3**, Three.js **0.186.1**, React Three Fiber **9.8.2**, Drei **10.7.9**, Tailwind CSS **4.3.3**, and Vitest **4.1.12**. `package-lock.json` records the exact installed versions.

The local shadcn-style UI components use Radix primitives and class-variance-authority. They are ordinary repository-owned React components, not a separately hosted component service. fflate packages the registered STL pair and recipe into one downloadable ZIP.

## Design and make

1. Choose a circle or soft square/rectangle. Change dimensions, full pleat count, membrane width, appearance, and preview expansion in real time. In **Finish**, select an LED column, one bulb, or two bulbs. Adjust each bulb's height independently and set light warmth from 1800–6500 K. Height percentages span the available vertical travel; the controls also show millimetres above the shade base. Open the help icon in the top bar for a guide to the process.
2. Review the live diagnostics after each change. **View checks** offers a correction button when a reliable parameter adjustment is available, with the proposed changes shown before applying and **Undo correction** for the most recent adjustment. Corrections preserve printer dimensions, LED requirements, and measured calibration; physical testing reminders remain manual. Inspect the compressed TPU body, material assembly, vertical section, and individual print layers. Numeric inputs and keyboard-operable sliders provide equivalent ways to set dimensions.
3. Set the intended printer’s **usable** build envelope, extrusion width, constant layer height, and integer TPU/PLA layer counts. Reserve space for margins and any prime tower in the usable dimensions you enter.
4. Export a short calibration specimen. The specimen preserves the selected cross section and process settings, with up to four full pleats.
5. Import both STLs together as parts of **one assembly**, retain their shared origin and relative placement, and interpret the coordinates as millimetres. Assign the shade to TPU and separators to PLA. Do not independently drop each STL to the bed.
6. Inspect both alternating connector-layer types in the slicer, print the specimen, and remove every PLA separator. Measure a comfortable deployed pitch per full pleat with the intended attachment arrangement, then enter that pitch to help plan the full shade.
7. Export the full compressed design once the geometry checks permit it. Capture both terminal TPU membranes in separate two-piece perimeter clamps; connect each end to the frame through four bolted supports. Fit the lower clamp first and secure the upper clamp at the calibrated deployment height. The clamps and other hardware are not included in the shade STL files.

Design settings are saved in browser local storage under `origamilamp.design.v1`. Use **Save recipe** for a portable versioned JSON file and **Import recipe** to reopen it. Older version 1 designs receive the original LED source and default warmth when the new lighting fields are absent. A malformed or out-of-range scalar value is rejected; editable geometric conflicts can be imported and are diagnosed before manufacture. Local storage is a convenience, not a substitute for exporting a recipe.

LED and bulb diameters are remembered separately and the selected diameter is used by the light and mounting clearance checks. Bulb placement and warmth affect the appearance preview only. The bulbs, sockets, stems, and hanging support are approximate hardware concepts, excluded from the shade STL files. The preview reports overlapping bulbs or insufficient vertical room without shrinking their selected diameter.

## Construction and units

One full pleat has two membrane legs, so `N = 2 × fullPleats`. Closed-loop TPU membranes connect alternately at their outer and inner rims. Each gap contains the appropriate TPU joining band and a complementary removable PLA separator. Switching whole layers between materials would leave disconnected washers; this implementation explicitly assigns both materials within connector layers.

Integer print-layer indices are the source of truth:

```text
membrane thickness t = TPU layer count × layer height
separator thickness s = PLA layer count × layer height
compressed body height = N × t + (N − 1) × s
```

The default 24 full pleats give 48 membranes, 47 separators, and a **38.0 mm** compressed body at 0.2 mm layers with two layers of each material. The first layer must use the same height; variable layer heights are unsupported.

Manufacturing geometry is centered in XY, uses **millimetres and Z-up**, and begins at Z = 0. The appearance scene uses metres and Y-up, with an explicit transform for the manufacturing view. Display height, preview expansion, object rotation, and visual material tone do not change the exported manufacturing geometry.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Canonical UI state, live diagnostics, process help, persistence, imports, and export actions. |
| `src/lib/lamp.ts` | Parameter types/defaults, exact print arithmetic, calibration parameters, and manufacturing gates. |
| `src/lib/printability-fixes.ts` | Per-check correction candidates, revalidated against the other geometry constraints. |
| `src/components/printability-checks.tsx` | Diagnostic rows, proposed adjustments, correction feedback, and undo. |
| `src/lib/manufacturing.ts` | Deterministic compressed TPU/PLA boundary meshes and normal-offset contours. |
| `src/lib/preview-geometry.ts` | Separate approximate expanded surface, flat terminal gripping flanges, and active membrane contraction. |
| `src/lib/mounting.ts` | Shared clamp dimensions, grip width, assembled opening and mounting eligibility. |
| `src/lib/lighting.ts` | Source dimensions, bulb placement, approximate colour temperature, and preview fit checks. |
| `src/components/light-controls.tsx` | Light-source selection, independent bulb heights, warmth, and source clearance controls. |
| `src/components/lamp-light-source.tsx` | Bulb and LED meshes, supports, point lights, and height-dependent shade glow. |
| `src/components/lamp-mounting.tsx` | Two-piece end clamps, bolted support links, and visible frame connections. |
| `src/lib/export.ts` | Versioned design JSON, binary STL encoding, ZIP packaging, and setup/removal instructions. |
| `src/components/lamp-viewer.tsx` | Three.js room/studio/manufacturing scenes, camera controls, material appearance, and renderer fallback. |
| `src/components/layer-inspector.tsx` | Inspectable layer schedule and material regions. |
| `src/components/ui/` | Reusable Radix-based button, slider, switch, tabs, and dialog components. |
| `src/index.css` | Design tokens, responsive layout, typography, focus states, and reduced-motion handling. |

The solid generator partitions each cross section into three normal-offset bands and each height interval into an integer print-layer slab. It emits only exterior faces of occupied cells, sharing boundary vertices across neighbours. This yields one continuous TPU solid and distinct PLA separator components without intersecting closed slabs, internal duplicate faces, or a dependency on slicer repair. The viewer and STL exporter use the same manufacturing generator.

Circle contours and rounded rectangles are supported for manufacture. Rounded rectangles preserve the corner centers while offsetting the corner arcs and straight edges; inner corners must remain rounded. The current conservative constraint is `bandWidth + 0.05 < cornerRadius < min(width, depth) / 2 − 0.05`. Invalid offsets, an aperture smaller than the prototype’s 20 mm minimum, and insufficient free membrane or connector widths block export. The 20 mm rule is a conservative software limit; it does not establish physical removability.

The expanded surface is intentionally a different representation. The first and last membrane sheets remain flat as gripping flanges, leaving `N − 2` active sloping membranes. The outside creases retain their nominal contour while the inside creases retract outward as axial rise consumes the free membrane span. Joining strips stay flat in this approximation. A one-pleat specimen has no active spans and is shown near its compressed height, without the mounted hardware. This is not a finite-element simulation or a printable mesh.

The mounting concept sandwiches the inner portion of each terminal membrane between two rigid perimeter rings, leaving the outer joining band free to flex. The default grip is 8 mm (reduced for narrower bands); the 3 mm clamp plates extend 6 mm inside the free aperture. Four bolts inside the aperture avoid inventing holes through the exported TPU. Separate supports connect each clamp to the frame, with frame-side fasteners and contact between the parts. The clamp opening participates in LED fit checks. These dimensions are a prototype concept, not a verified hardware specification; testing must establish grip, required tension and long-term deformation. No load rating or tightening torque is predicted.

## Verification

The Vitest suite independently examines generated triangles and exported files. It checks:

- Watertight, oppositely oriented edge pairs, positive signed volume, absence of duplicate/degenerate faces, and connected-component counts.
- One TPU component and exactly `N − 1` separate PLA components across circles, rounded rectangles, short/long stacks, narrow bands, and alternative layer recipes.
- Analytic volume agreement, integer-layer Z boundaries, material assignment inside membranes and both alternating gaps, and an accessible separator-removal direction.
- Stable print geometry when appearance settings change, preview contraction, calibration footprint/counts, and invalid geometry/export gates.
- Registered binary STL coordinates, ZIP contents, and versioned recipe import/export.

These are software geometry checks. **Target-slicer acceptance and physical print acceptance remain pending.** Before claiming a tested process, inspect actual toolpaths, verify release and connector bonding on a specimen, record measured pitch, and record the printer/material/profile combination. A 45° bridge direction is only a source-informed starting point; explicit PLA geometry may cause a slicer to use solid-infill or surface paths instead of bridge paths.

## Current limits

- **Polygon profiles, twist, and size modulation are appearance studies only.** Their controls update the preview, but manufacturing export is blocked until a shared-connector construction is implemented and validated.
- The export is a registered **two-STL ZIP**, with `shade-tpu.stl`, `separators-pla.stl`, `design.json`, and `READ-ME.txt`. **3MF export is not implemented.** STL has no dependable unit/material metadata; assignment instructions accompany the meshes.
- No printer-specific G-code, tested slicer project, automatically calibrated material profile, or support-generation route is supplied. The modeled PLA parts already occupy separator volumes; do not duplicate them with automatic supports.
- Physical folding, release, fatigue, final diameter, achievable height, optical output, and unsupported stability are unvalidated. Entering measured pitch supplies a planning estimate, with end effects still unresolved.
- The preview now shows both end membranes captured by rigid clamps with bolted frame connections. These clamps, brackets, fasteners, the wooden frame and LED core remain separate hardware concepts. Exported TPU/PLA meshes retain open ends and exclude the rigid hardware, peel tabs, raft and process structures. Mounting grip, stiffness and load capacity still need physical testing.
- Light clearance checks include the clamp aperture intrusion and user-supplied module dimensions. They do not certify deployed clearance, temperature, ventilation, electrical safety, or thermal performance.
- The Japanese room uses procedural geometry and textures for a balanced visual setting. It is an atmospheric approximation, not a photographic room scan, calibrated lighting simulation, physics simulation, or certified feng shui assessment.
- Design remains available through the controls if WebGL cannot render. Keyboard controls, visible focus, labelled inputs, reduced motion, and status text are included; automated accessibility checks do not replace assistive-technology and user testing.

## Brief and references

The governing specification is [`docs/OrigamiLampAgentBrief.txt`](docs/OrigamiLampAgentBrief.txt). It distinguishes observations from the reference work from the proposed engineering implementation and lists the slicer/physical acceptance criteria.

The bellows concept is informed by [Josh Makeshift’s lamp video](https://www.youtube.com/watch?v=7Q6UgnpUG1g), as documented in that brief. This repository is an independent implementation and does not reproduce the creator’s exact CAD or a validated printer recipe. Supporting sources and attribution details are recorded in the brief.

Implementation references: [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html), [fflate](https://github.com/101arrowz/fflate), and the source/type declarations of the installed dependencies.
