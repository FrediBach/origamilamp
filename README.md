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

The local shadcn-style UI components use Radix primitives and class-variance-authority. They are ordinary repository-owned React components, not a separately hosted component service. fflate packages the registered STL material parts and recipe into one downloadable ZIP.

## Design and make

1. Choose a circle or soft square/rectangle. Change dimensions, full pleat count, membrane width, appearance, and preview expansion in real time. In **Finish → Top and bottom mounting**, select bolted supports or short metal springs. In **Finish**, select an LED column, one bulb, or two bulbs. Adjust each bulb's height independently and set light warmth from 1800–6500 K. Height percentages span the available vertical travel; the controls also show millimetres above the shade base. Open the help icon in the top bar for a guide to the process.
2. Review the live diagnostics after each change. **View checks** offers a correction button when a reliable parameter adjustment is available, with the proposed changes shown before applying and **Undo correction** for the most recent adjustment. Corrections preserve printer dimensions, LED requirements, and measured calibration; physical testing reminders remain manual. Inspect the compressed TPU body, material assembly, vertical section, and individual print layers. Numeric inputs and keyboard-operable sliders provide equivalent ways to set dimensions.
3. Set the intended printer’s **usable** build envelope, extrusion width, constant layer height, and integer TPU/PLA layer counts. Reserve space for margins and any prime tower in the usable dimensions you enter.
4. Export a short calibration specimen. The specimen preserves the selected cross section and process settings, with up to four full pleats.
5. Import all STLs together as parts of **one assembly**, retain their shared origin and relative placement, and interpret the coordinates as millimetres. Assign the shade to TPU and separators to PLA; enabled lettering has a third STL for the second TPU color. Do not independently drop each STL to the bed.
6. Inspect both alternating connector-layer types in the slicer, print the specimen, and remove every PLA separator. Measure a comfortable deployed pitch per full pleat with the intended attachment arrangement, then enter that pitch to help plan the full shade.
7. Export the full compressed design once the geometry checks permit it. Capture both terminal TPU membranes in separate two-piece perimeter clamps; connect each end to the frame through four bolted supports or four short metal extension springs. With bolted supports, fit the lower clamp first and secure the upper clamp at the calibrated deployment height. With springs, support the shade while fitting both sets, then balance opposing spring pairs at the calibrated height. The clamps, springs and other hardware are not included in the shade STL files.

In **Finish → Wooden electronics box**, optionally add a wooden compartment beneath the lamp for electronics and wiring. Set its usable internal height from **20–120 mm** (default 40 mm); the preview raises the lamp above the compartment. The compartment uses 6 mm walls and a 6 mm lid above the existing wooden base. It is a space reservation: component fit, cable routing, ventilation and electrical design require separate verification. The wooden box is separate hardware and is excluded from the shade STLs.

In **Finish**, choose the support frame's wood from **oak, ash, maple, cherry, walnut, or smoked oak**. Each finish has its own grain character, colour and brightness under the scene's lighting. The base board follows the frame when the electronics box is disabled. Enable the box to choose its wood independently, or keep **Match frame** to follow later frame changes; the selected box finish covers its base board, walls and lid. Wood choices affect the appearance preview and hardware recipe only.

Design settings are saved in browser local storage under `origamilamp.design.v1`. Use **Save recipe** for a portable versioned JSON file and **Import recipe** to reopen it. Older version 1 designs receive the original LED source, standard lamp brightness (100% intensity), default warmth, steady light (0% flicker), bolted attachment, disabled electronics box with a 40 mm internal height, oak frame and matching box wood when those newer fields are absent. Explicit invalid values are rejected instead of being silently replaced. A malformed or out-of-range scalar value is rejected; editable geometric conflicts can be imported and are diagnosed before manufacture. The selected attachment, electronics box settings, frame and box woods, and matching setup instructions are included in the manufacturing ZIP. Local storage is a convenience, not a substitute for exporting a recipe.

In **Finish → Lamp light intensity**, set the lamp's brightness from **0–200%**: **0%** turns it off, **100%** is standard brightness, and **200%** doubles its light output. This controls the LED column or bulbs, shade glow, and cast light together in room and studio previews, independently of the ceiling light. **Preview light** remains the lamp's master switch and preserves the chosen intensity when turned off. The intensity is saved with the design and portable recipe.

In **Finish → Light flicker**, use one **0–100%** control to add an irregular bulb flutter to the LED column, one bulb, or two bulbs. **0%** keeps the light steady; increasing the amount creates deeper fluctuations, with noticeable dimming at the upper end. Flicker scales the selected lamp intensity. The setting remains editable with **Preview light** off and is saved with the design and portable recipe. Flicker affects the appearance preview only, leaves the ceiling light steady, and does not change the shade STL files.

LED and bulb diameters are remembered separately and the selected diameter is used by the light and mounting clearance checks. Bulb placement, intensity, warmth and flicker affect the appearance preview only. The bulbs, sockets, stems, and hanging support are approximate hardware concepts, excluded from the shade STL files. The preview reports overlapping bulbs or insufficient vertical room without shrinking their selected diameter.

## Construction and units

Enable **Finish → Multicolor text** for one additional TPU color: **black, brown, or beige**. Enter up to 24 capital letters, digits, spaces or `. ! ? -`, then adjust letter height (40–300 mm), rotation, direction around the shade, horizontal placement and vertical placement. The bundled **Helvetiker Bold** font uses heavy, smoothly curved vector outlines with real letter counters; it works offline and includes its original MAGENTA license in `src/assets/fonts/LICENSE`.

Lettering **wraps continuously around the whole shade**, following the true outside-perimeter distance across corners, sides, the back and the perimeter seam. Rotation acts on the unwrapped perimeter-and-height plane. The controls show the text's horizontal span beside the shade's circumference; **Fit around shade** adjusts its size to leave room around the circumference. Longer text continues around another turn, with overlapping letters merging into the same accent color. The layout uses the target deployed height: changing preview expansion or viewing rotation keeps material coordinates fixed, while changing the target height changes the printable layout.

Lettering replaces base TPU within the existing membrane layers. It adds no raised overlay or extra thickness. Both joining bands and both clamped terminal membranes retain the base TPU color for continuous creases and grips. Exact corner contacts receive a local base-TPU bridge one intended extrusion width across so exported color regions stay closed after STL vertex welding. Patterned PLA recesses remain unchanged. With lettering enabled, the ZIP adds **`shade-text-tpu.stl`** alongside `shade-tpu.stl` and `separators-pla.stl`; keep all three at their shared origin and assign compatible base TPU, accent TPU and removable PLA. Lettering requires at least two full pleats so there are active membranes between the terminal clamps. Test color-boundary adhesion and folded strength on the short calibration specimen.

The visible letters and native light-shadow passes share the same continuous glyph mask and folded material coordinates. Lettering blocks the lamp's point lights as well as ceiling and studio lighting, preserving letter edges and openings in projected shadows. Black and brown block more light than beige. The softened optical maps handle only the base TPU, so they do not blur or duplicate the letter shadow. For distinct silhouettes, select **One bulb**, place it above the text, and dim the ceiling light; the full-height LED column produces overlapping shadows that can fill in small letters. Shadow placement also depends on bulb height and text placement. Pigment transmission and partial-shadow coverage are illustrative rather than measured filament properties. Older saved designs load with lettering disabled.

Lettered previews soften shadow edges and average partial material coverage on the GPU. The filter uses 8 samples during interaction, then 24 after 120 ms idle, 64 after 350 ms, and a dense 256-sample filter after 650 ms; continuous flicker caps at 24. Refinement stops once settled and pauses when the preview is hidden or offscreen. Camera movements and quality changes reuse the existing shadow maps, while scene changes refresh them. This avoids continuous background rendering and a separate worker or duplicate scene.

In **Form → Light patterns**, optionally choose **Triangles**, **Half circles**, or **Rectangles**. These are thinner TPU regions, not open holes. Set the repeat count (4–32), **Cutout spacing** (5–80% of each repeat), depth (10–75% of the membrane band), and remaining whole TPU layers. Increasing spacing widens the solid gaps and narrows the cutout mouths while retaining the repeat count; the controls show both dimensions in millimetres along the outside edge. The remaining layer count must be at least one and less than the full membrane count. Patterns start disabled, including when opening recipes from before patterns were available.

**Pattern every** sets a membrane interval from 1–24. It starts at the first unclamped membrane: 1 patterns every folding membrane, 2 patterns active membranes 1, 3, 5…, and 3 patterns active membranes 1, 4, 7…. These are folded membranes, not individual printer layers. Skipped membranes stay full thickness. The two end membranes always remain full thickness. Existing patterned recipes without these controls retain their original 30% spacing and interval of 1. Both controls are saved in designs and included in the calibration and full STL exports.

**Phase per membrane** advances placement by −100–100% of one pattern repeat per folded membrane. The first unclamped membrane starts at zero: 25% produces offsets of 0%, 25%, 50%, 75%, then 0% again. Negative values reverse the direction, and 100% advances a whole repeat so the patterns align again. Phase advances across skipped membranes too: with **Pattern every 3** and **25% phase**, successive patterned membranes have offsets of 0%, 75%, 50%, 25%…. Older designs without this setting load at 0%. Placement wraps continuously around the perimeter, including recesses crossing its coordinate seam.

Patterns are part of both manufacturing STLs and open **only at the outside perimeter**. Selected odd-indexed membranes have top recesses; selected even-indexed membranes have bottom recesses (zero-based print-stack indices). Each joins an outward-opening PLA separator. Continuous TPU remains below top recesses and above bottom recesses, preserving the outer joins on the opposite face. Inner folds and the two terminal clamping membranes stay full thickness. Recesses widen toward their outside mouths. Rectangles have rounded inward corners and slightly drafted sides; the corner radius scales with depth and mouth width, while the outside mouth stays open. Depth is limited before the inner connector with an additional extrusion-width web. The layer inspector's **Top pattern layer** and **Bottom pattern layer** jumps find the first selected membrane with that recess face; a jump is hidden when the interval leaves no such membrane. Its section stays at the first active membrane's pattern centre, so phased recesses can move in and out of that fixed section. The 3D section shows each membrane's actual centre-plane intersection. Phase and rounded corners are included in saved designs, preview lighting, and both STL exports. Regenerate older patterned STLs to use the updated geometry.

The patterned preview uses the remaining TPU thickness for its glow and traces light rays through the expanded folds to shade the floor, room and hardware. Shared crease bands account for both neighbouring membranes and their retained TPU connector, including when one membrane is skipped. Absorption increases with thickness, oblique incidence and repeated membrane crossings; a source-size blur softens the projected patterns. Existing frame and furniture shadows still block the transmitted light. Light placement, rotation, intensity and flicker stay aligned with the shade. This is an optical approximation using eight stored crossing depths per ray; additional crossings in tightly compressed views are combined at the eighth. TPU scattering and transmission are not calibrated material measurements.

Print the patterned calibration specimen before the full shade. Geometric connectivity and unobstructed extraction paths do not certify TPU/PLA adhesion, tear resistance, or real release force. Peel the recess tongues out with their separator and inspect every thin membrane. Selecting only one TPU layer for the full membrane, or leaving no active folding sheets, blocks patterned export until corrected.

One full pleat has two membrane legs, so `N = 2 × fullPleats`. Closed-loop TPU membranes connect alternately at their outer and inner rims. Each gap contains the appropriate TPU joining band and a complementary removable PLA separator. Switching whole layers between materials would leave disconnected washers; this implementation explicitly assigns both materials within connector layers.

Integer print-layer indices are the source of truth:

```text
membrane thickness t = TPU layer count × layer height
separator thickness s = PLA layer count × layer height
compressed body height = N × t + (N − 1) × s
```

The default 24 full pleats give 48 membranes, 47 separators, and a **38.0 mm** compressed body at 0.2 mm layers with two layers of each material. The first layer must use the same height; variable layer heights are unsupported.

Manufacturing geometry is centered in XY, uses **millimetres and Z-up**, and begins at Z = 0. The appearance scene uses metres and Y-up, with an explicit transform for the manufacturing view. Display height, preview expansion, object rotation, attachment choice, electronics box settings, wood choices, and visual material tone do not change the exported manufacturing geometry.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Canonical UI state, live diagnostics, process help, persistence, imports, and export actions. |
| `src/lib/lamp.ts` | Parameter types/defaults, exact print arithmetic, calibration parameters, and manufacturing gates. |
| `src/lib/printability-fixes.ts` | Per-check correction candidates, revalidated against the other geometry constraints. |
| `src/components/printability-checks.tsx` | Diagnostic rows, proposed adjustments, correction feedback, and undo. |
| `src/lib/manufacturing.ts` | Deterministic compressed TPU/PLA boundary meshes and normal-offset contours. |
| `src/lib/cutout-patterns.ts` | Shared edge-open pattern contours, recess footprints, print partition and minimum retained web. |
| `src/components/pattern-controls.tsx` | Optional light patterns, repeat count, spacing, membrane interval, phase advance, safe depth and remaining TPU layers. |
| `src/lib/pattern-lighting.ts` | Thickness and incidence attenuation through expanded folds, stored as angular optical maps. |
| `src/components/pattern-light-projection.tsx` | Transmitted point-light radiance on room, floor and hardware materials. |
| `src/lib/preview-geometry.ts` | Separate approximate expanded surface, flat terminal gripping flanges, and active membrane contraction. |
| `src/lib/mounting.ts` | Shared clamp dimensions, grip width, assembled opening and mounting eligibility. |
| `src/lib/base.ts` | Wooden base compartment dimensions, internal space and assembly elevation. |
| `src/lib/wood.ts` | Shared wood species, finish colours and procedural grain settings. |
| `src/lib/wood-texture.ts` | Deterministic timber colour and pore maps, physical grain scale, and sawn end grain. |
| `src/components/wood-controls.tsx` | Support and box wood choices, with an optional matching finish. |
| `src/components/base-controls.tsx` | Optional electronics compartment toggle, usable height and internal space readout. |
| `src/components/lamp-base.tsx` | Wooden base, compartment walls, lid and cable opening in the appearance preview. |
| `src/components/mounting-controls.tsx` | Top and bottom attachment selection and matching hardware guidance. |
| `src/lib/lighting.ts` | Source dimensions, bulb placement, approximate colour temperature, and preview fit checks. |
| `src/components/light-controls.tsx` | Light-source selection, independent bulb heights, warmth, and source clearance controls. |
| `src/components/lamp-light-source.tsx` | Bulb and LED meshes, supports, point lights, and height-dependent shade glow. |
| `src/components/lamp-mounting.tsx` | Two-piece end clamps, bolted links or coiled metal springs, and visible frame connections. |
| `src/lib/export.ts` | Versioned design JSON, binary STL encoding, ZIP packaging, and setup/removal instructions. |
| `src/lib/text-projection.ts` | Continuous perimeter wrapping, vector-outline clipping, and conforming membrane color partitions. |
| `src/lib/text-font.ts` | Bundled Helvetiker Bold outlines and smooth deterministic curve sampling. |
| `src/components/lamp-viewer.tsx` | Three.js room/studio/manufacturing scenes, camera controls, material appearance, and renderer fallback. |
| `src/components/layer-inspector.tsx` | Inspectable layer schedule and material regions. |
| `src/components/ui/` | Reusable Radix-based button, slider, switch, tabs, and dialog components. |
| `src/index.css` | Design tokens, responsive layout, typography, focus states, and reduced-motion handling. |

The solid generator partitions each cross section into three normal-offset bands and each height interval into an integer print-layer slab. With patterns, each membrane has a planar partition for its phase, following the rounded recess boundaries and connector edges. Separator ends share their neighbouring membrane's partition, and triangulated side walls connect the two perimeter samplings. Membrane slabs alternate between continuous-TPU/recess and recess/continuous-TPU according to the outward-opening separator's position. It emits only exterior faces of occupied cells, sharing boundary vertices across neighbours, and merges coplanar exposed regions to reduce mesh size. Optional vector lettering clips the same cells in unwrapped perimeter coordinates and restores their shared edge subdivisions. Together, the TPU colors occupy one continuous shade, with distinct PLA separator components and no overlapping material volumes. The viewer and STL exporter use the same manufacturing generator.

Circle contours and rounded rectangles are supported for manufacture. Rounded rectangles preserve the corner centers while offsetting the corner arcs and straight edges; inner corners must remain rounded. The current conservative constraint is `bandWidth + 0.05 < cornerRadius < min(width, depth) / 2 − 0.05`. Invalid offsets, an aperture smaller than the prototype’s 20 mm minimum, and insufficient free membrane or connector widths block export. The 20 mm rule is a conservative software limit; it does not establish physical removability.

The expanded surface is intentionally a different representation. The first and last membrane sheets remain flat as gripping flanges, leaving `N − 2` active sloping membranes. The outside creases retain their nominal contour while the inside creases retract outward as axial rise consumes the free membrane span. Joining strips stay flat in this approximation. A one-pleat specimen has no active spans and is shown near its compressed height, without the mounted hardware. This is not a finite-element simulation or a printable mesh.

The mounting concept sandwiches the inner portion of each terminal membrane between two rigid perimeter rings, leaving the outer joining band free to flex. The default grip is 8 mm (reduced for narrower bands); the 3 mm clamp plates extend 6 mm inside the free aperture. Four bolts inside the aperture avoid inventing holes through the exported TPU. Four separate connections per end join each clamp to the frame: either rigid bolted supports or short coiled metal extension springs with hooks and anchors. The spring option suspends the top and bottom like a trampoline while retaining the same terminal clamps. The clamp opening participates in light fit checks. These dimensions are a prototype concept, not a verified hardware specification; testing must establish grip, required tension and long-term deformation. Spring rate, initial tension, working travel and hook retention require physical calibration. No spring force, dynamic motion, load rating or tightening torque is predicted.

## Verification

The Vitest suite independently examines generated triangles and exported files. It checks:

- Watertight, oppositely oriented edge pairs, positive signed volume, absence of duplicate/degenerate faces, and connected-component counts.
- One TPU component and exactly `N − 1` separate PLA components across circles, rounded rectangles, short/long stacks, narrow bands, and alternative layer recipes.
- Analytic volume agreement, integer-layer Z boundaries, material assignment inside membranes and both alternating gaps, and an accessible separator-removal direction.
- Stable print geometry when appearance settings change, preview contraction, calibration footprint/counts, and invalid geometry/export gates.
- Registered binary STL coordinates, ZIP contents, versioned recipe import/export, attachment, wood and lighting-setting migration, and identical printable geometry across hardware, wood, intensity and flicker choices.

These are software geometry checks. **Target-slicer acceptance and physical print acceptance remain pending.** Before claiming a tested process, inspect actual toolpaths, verify release and connector bonding on a specimen, record measured pitch, and record the printer/material/profile combination. A 45° bridge direction is only a source-informed starting point; explicit PLA geometry may cause a slicer to use solid-infill or surface paths instead of bridge paths.

## Current limits

- **Polygon profiles, twist, and size modulation are appearance studies only.** Their controls update the preview, but manufacturing export is blocked until a shared-connector construction is implemented and validated.
- The export is a registered **two- or three-STL ZIP**, with `shade-tpu.stl`, `separators-pla.stl`, optional `shade-text-tpu.stl`, `design.json`, and `READ-ME.txt`. **3MF export is not implemented.** STL has no dependable unit/material metadata; assignment instructions accompany the meshes.
- No printer-specific G-code, tested slicer project, automatically calibrated material profile, or support-generation route is supplied. The modeled PLA parts already occupy separator volumes; do not duplicate them with automatic supports.
- Physical folding, release, fatigue, final diameter, achievable height, optical output, and unsupported stability are unvalidated. Entering measured pitch supplies a planning estimate, with end effects still unresolved.
- The preview shows both end membranes captured by rigid clamps with bolted frame connections or short metal springs at both ends. These clamps, springs, brackets, fasteners, the wooden frame and light sources remain separate hardware concepts. Exported TPU/PLA meshes retain open ends and exclude the attachment hardware, peel tabs, raft and process structures. Mounting grip, spring selection, stiffness and load capacity still need physical testing.
- Light clearance checks include the clamp aperture intrusion and user-supplied module dimensions. They do not certify deployed clearance, temperature, ventilation, electrical safety, or thermal performance.
- The Japanese room uses procedural geometry and textures for a balanced visual setting. It is an atmospheric approximation, not a photographic room scan, calibrated lighting simulation, physics simulation, or certified feng shui assessment.
- Design remains available through the controls if WebGL cannot render. Keyboard controls, visible focus, labelled inputs, reduced motion, and status text are included; automated accessibility checks do not replace assistive-technology and user testing.

## Brief and references

The governing specification is [`docs/OrigamiLampAgentBrief.txt`](docs/OrigamiLampAgentBrief.txt). It distinguishes observations from the reference work from the proposed engineering implementation and lists the slicer/physical acceptance criteria.

The bellows concept is informed by [Josh Makeshift’s lamp video](https://www.youtube.com/watch?v=7Q6UgnpUG1g), as documented in that brief. This repository is an independent implementation and does not reproduce the creator’s exact CAD or a validated printer recipe. Supporting sources and attribution details are recorded in the brief.

Implementation references: [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html), [fflate](https://github.com/101arrowz/fflate), and the source/type declarations of the installed dependencies.
