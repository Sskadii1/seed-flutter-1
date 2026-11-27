# SEED Wonder Board — Typography, Spatial Layout & Animation Speed Hotfix Report

**Date:** 2026-11-27  
**Workspace:** `c:\Users\linhn\Downloads\SEED`  
**Localhost Web Build:** `http://localhost:4173` (`index-c42c6b48cead5573505408105a0aa49f.js`, `782 kB`, `Cache-Control: no-store`)

---

## 1. Root Cause Analysis

1. **Mixed-Language Font Glitch (`Â`, `ê`, `ư`, `ơ`, `đ`, `ử`, `ữ` mismatching ASCII/Latin):**
   - **Root Cause:** Korean chalk font `Gaegu` was placed ahead of Vietnamese fonts in `FONT_CHALK_KO`, causing browsers to render ASCII letters (`m`, `t`, `n`) in `Gaegu` while falling back only individual accented Vietnamese codepoints (`Â`, `ê`, `ư`, `ụ`, `ử`) to a generic sans-serif with mismatched stroke weight and cap height. Additionally, all text inside `<text>` used a single monolithic string without script segmentation, Unicode NFC normalization, or per-run baseline/scale calibration, while PNG export captured only Layer 2 canvas strokes (`canvasRef.current.toDataURL()`) without Layer 4 SVG clouds/annotations.
   - **Fix:** Added [`wonder-typography.ts`](packages/learning-engine/src/wonder-typography.ts) (`segmentUnicodeGraphemes`, `segmentMixedLanguageRuns`, `wrapMixedLanguageRuns`, `computeAdaptiveAnnotationTypography`), rendered SVG annotations with explicit per-script `<tspan>` runs (`Playpen Sans`/`Be Vietnam Pro` for Vietnamese/Latin, `Gaegu`/`Noto Sans KR` for Hangul/Jamo, `Be Vietnam Pro` for `[IPA]` and math symbols), wired `waitForWonderFontsReady()` + `document.fonts.addEventListener('loadingdone')` with Canvas 2D `measureText` re-measurement and non-replay preservation, and implemented `renderExportPngDataUrl()` to composite strokes, clouds, arrows, and mixed-language runs into PNG export.

2. **Spatial Collisions (Arrow / Cloud Overlapping Text & Fixed Note Sizes):**
   - **Root Cause:** Text bounding boxes were estimated with fixed character multipliers and never re-measured after web fonts loaded; `computeCollisionFreePlacement` only tested 4 cardinal offsets and stopped the arrowhead `6px` from `noteBox` without validating that intermediate arrow/head points stayed outside foreign blockers and the destination note box.
   - **Fix:** Live Canvas `measureText` wrapping dynamically drives `resolvedLayoutByAnnId` in [`WonderBoardScreen.tsx`](apps/mobile/src/screens/WonderBoardScreen.tsx) passing strokes, neighboring clouds, previously placed notes, teaching cards, and live writing bounds into the upgraded 8 cardinal+diagonal + 2D radial search in `computeCollisionFreePlacement` ([`wonder-board.ts`](packages/learning-engine/src/wonder-board.ts)) with `12px` exterior arrow stop clearance and shaft+arrowhead blocker guards.

3. **Slow Cloud & Typewriter Animation Latency:**
   - **Root Cause:** Cloud durations (`3200–6800ms`) and per-grapheme typewriter timing (`85ms`/`28ms`) took 5–10+ seconds per annotation and ignored queue depth.
   - **Fix:** Added `computeCloudDurationMs` (`drawingSpeed = 820 px/s`, `clamp(..., 600, 1800)` at natural), `computeAnnotationPhaseTimings` (arrow `200–350ms`, pauses `70ms`, correction `~45ms/grapheme`, explanation `~24ms/grapheme` capped `<= 1450ms`), priority-aware `computeQueueSpeedMultiplier` (`1 -> 1.0x`, `2–3 -> 0.78x`, `4–6 -> 0.55x`, `>6 -> 0.42x`), latched per-annotation timing schedules immune to pan/zoom, click-to-complete interaction on active clouds/notes, and telemetry breakdown (`lastCloudAnimDurationMs`, `lastTextRevealDurationMs`, `lastTotalTimeToFeedbackMs`).

---

## 2. Modified & Added Files

- [`packages/schema/src/wonder-board.ts`](packages/schema/src/wonder-board.ts) — Added `lastCloudAnimDurationMs`, `lastTextRevealDurationMs`, and `lastTotalTimeToFeedbackMs` to `WonderTelemetryMetrics`.
- [`packages/learning-engine/src/wonder-typography.ts`](packages/learning-engine/src/wonder-typography.ts) — Unicode NFC grapheme segmentation, script-aware font run builder, zoom-adaptive CSS/world typography scaler, `measureText`-backed wrapper, animation timing & queue speed calculators.
- [`packages/learning-engine/src/index.ts`](packages/learning-engine/src/index.ts) — Exported `./wonder-typography`.
- [`packages/learning-engine/src/wonder-board.ts`](packages/learning-engine/src/wonder-board.ts) — Upgraded `makeArrowBetween` and `computeCollisionFreePlacement` (8 cardinal/diagonal candidates, 2D radial ring fallback, `12px` arrow stop padding, shaft + arrowhead blocker validation).
- [`apps/mobile/src/lib/typography.ts`](apps/mobile/src/lib/typography.ts) — Vietnamese-first chalk stack (`FONT_CHALK`, `FONT_CHALK_VI`, `FONT_CHALK_KO`) and `waitForWonderFontsReady()`.
- [`apps/mobile/src/lib/wonderBoardStore.ts`](apps/mobile/src/lib/wonderBoardStore.ts) — Preserved valid user `animationSpeed` during board storage migration (`'natural'` default only when missing/invalid).
- [`apps/mobile/src/screens/WonderBoardScreen.tsx`](apps/mobile/src/screens/WonderBoardScreen.tsx) — Live `<tspan>` mixed-language rendering, Canvas `measureText` re-layout on `fontEpoch`, latched queue-aware animation scheduler, reduced-motion listener, click-to-skip, unified PNG export compositor, and `__WONDER_BOARD_TEST__` helpers.
- [`packages/learning-engine/test/wonder-v3.test.ts`](packages/learning-engine/test/wonder-v3.test.ts) — Added `V3-13` covering all 6 mixed-language strings, adaptive bounds, timing gates, and arrow/note clearance.
- [`scripts/verify-wonder-board-hotfix.mjs`](scripts/verify-wonder-board-hotfix.mjs) — Automated browser verification generating screenshots and [`docs/visual-evidence-hotfix/animation-trace.json`](docs/visual-evidence-hotfix/animation-trace.json).

---

## 3. Observed Animation Timing & Zoom Measurements (`animation-trace.json`)

| Gate / Scenario | Configured Schedule | Observed Browser Measurement | Criteria |
| :--- | :--- | :--- | :--- |
| **A01 Small Cloud (`natural`)** | `822 ms` (total `2581 ms`) | `actualCloudMs: 833 ms` | `600–900 ms` (`PASS`) |
| **A02 Medium Cloud (`natural`)** | `1262 ms` (total `3021 ms`) | `actualCloudMs: 1270 ms` | `900–1300 ms` (`PASS`) |
| **A03 Large Cloud (`natural`)** | `1800 ms` (total `3559 ms`) | `actualCloudMs: 1798 ms` | `<= 1800 ms` (`PASS`) |
| **A09 4-Item Queue (`natural`)** | Mult `0.55 -> 0.78 -> 0.78 -> 1.0` | Cloud `511 / 734 / 750 / 985 ms`, Text `849 / 1022 / 1146 / 1366 ms` | Sequential adaptive speed, 4/4 finished, live ink preserved (`PASS`) |
| **Zoom 45% .. 200%** | Adaptive CSS->World compensation | Cloud `5.71..2.89 px`, Corr `46..21 px`, Expl `30..15 px` | Zero DOM collisions across `45%, 75%, 100%, 150%, 200%` (`PASS`) |

---

## 4. Visual Evidence & Regression Verification Results

- **`ZERO_EMOJIS_OK`:** No OS emojis in `apps/mobile/src/**/*.{ts,tsx}`.
- **`pnpm typecheck`:** `3/3` workspace projects passed (`@seed/schema`, `@seed/learning-engine`, `@seed/mobile`).
- **`pnpm test`:** **`23/23` tests passed** (`engine.test.ts`, `wonder-board.test.ts`, `wonder-v3.test.ts` including `V3-13`, total `966.69 ms`, 0 failed, 0 skipped).
- **`pnpm validate`:** `ALL VALIDATION & SIMULATION CHECKS PASSED`.
- **`pnpm export:web`:** Bundled `232` modules (`782 kB`).
- **`node scripts/verify-wonder-board-v2-browser.mjs`:** `ALL 15 V2 BROWSER VERIFICATION SCREENSHOTS PASSED & SAVED.`
- **`node scripts/verify-wonder-board-v3-sessions.mjs`:** `ALL V3 CONTINUOUS SESSIONS A-G PASSED & SAVED.`
- **`node scripts/verify-wonder-board-hotfix.mjs`:** `HOTFIX VISUAL, TYPOGRAPHY, SPATIAL COLLISION & ANIMATION VERIFICATION PASSED.` (`56` `<tspan>` runs across `'Gaegu', 'Noto Sans KR'`, `'Playpen Sans', 'Be Vietnam Pro'`, and `'Be Vietnam Pro', 'Noto Sans KR'`; zero replay after `document.fonts.ready` or mid-animation writing; `prefers-reduced-motion` instant pass; reload persistence intact).
- **Inspected Hotfix Artifacts (`docs/visual-evidence-hotfix/`):**
  - [`02_mixed_typography_fonts_loaded.png`](docs/visual-evidence-hotfix/02_mixed_typography_fonts_loaded.png) & [`03_exported_board_canvas.png`](docs/visual-evidence-hotfix/03_exported_board_canvas.png): Uniform Vietnamese & Korean chalk runs, clean non-overlapping diagonal & side placement, 1:1 PNG export parity.
  - [`07_queue_completed_zero_collisions.png`](docs/visual-evidence-hotfix/07_queue_completed_zero_collisions.png) & [`06_queue_and_writing_mid_anim.png`](docs/visual-evidence-hotfix/06_queue_and_writing_mid_anim.png): Multi-annotation sequential draw with unobstructed text regions and preserved mid-animation ink stroke.

---

## 5. Known / Remaining Limitations

1. **Dense Multi-Cloud Grid Edge Case:** When 4 large clouds are placed tightly in a 2×2 grid (`y = 65` & `y = 320`, left edge `x = 80`), a top-left cloud whose `above`, `left`, `right`, and `below` pockets are all hemmed in by neighbor clouds can still fall back to placing its note below row 2 with a long arrow crossing row 2's cloud interior (verified not to overlap any note text box).
2. **Offline Fonts & Physical Device Testing:** `Playpen Sans`, `Gaegu`, and `Be Vietnam Pro` require internet access to `fonts.googleapis.com` (offline environments fall back cleanly via `Be Vietnam Pro` ahead of `Gaegu` without `ê`/`ư` fallback spikes). Physical iPad + Apple Pencil hardware testing remains outside this sandbox (`NOT TESTED ON PHYSICAL DEVICE`).
