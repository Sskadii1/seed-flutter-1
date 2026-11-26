# SEED Wonder Board V2 — Architecture, Specs, Benchmark & Release Report

> Related Baseline Audit: [`WONDER_BOARD_V2_GAP_ANALYSIS.md`](WONDER_BOARD_V2_GAP_ANALYSIS.md)

---

## 1. Release Readiness Classification (Evidence-Based — Section 30)

**Current Status:** **`INTEGRATION_READY`** (not `AI_RECOGNITION_VALIDATED` or `DEVICE_VALIDATED` or `PRODUCTION_READY`)

Why this exact classification:
- **Passed & Verified:** Warm beige V2 chalkboard architecture, organic cubic-Bézier cloud geometry with verified positive ink clearance, continuous single-stroke `0% -> 25% -> 50% -> 75% -> 100%` chalk path animation + chalk tip nib + single-teacher sequential queue, direct-on-canvas handwritten feedback (no white tooltip popups), continuous `N -> N+1` incremental dirty-region & self-correction reconciliation, multi-error detection, schema validation, v1 -> v2 storage migration, 10/10 automated unit/integration tests, and **16 live headless Chrome verification screenshots** (`EMULATED` iPad viewports).
- **Honest Blockers to Higher Labels:**
  1. **Real Human Handwriting Dataset (`NOT_AVAILABLE`):** `local-stroke-v2` validates deterministic synthetic fixtures & held-out compositional rules cleanly, while open-ended human cursive Korean handwriting requires enabling the opt-in Cloud Vision/LLM pipeline (behind a server-side proxy in production).
  2. **Physical iPad Apple Pencil (`NOT TESTED ON PHYSICAL DEVICE`):** iPad landscape/portrait layout and Pointer Events (`pointerType`, `pressure`, `tilt`, `getCoalescedEvents`, 2-finger pinch) were verified in headless Chrome emulation (`EMULATED`), not on physical iPadOS Safari + Apple Pencil hardware.

---

## 2. Cloud Geometry & Chalk Animation Specifications (`CLOUD_GEOMETRY_SPEC` & `CHALK_ANIMATION_SPEC`)

### Cloud Geometry V2 (`generateScallopedCloudGeometry`)
- **Visual Ink Bounds:** `computeStrokeBoundingBox` pads stroke centerline points by actual rendered ink radius `(strokeWidth * pressureFactor) / 2 + 1.5` so stroke edges are never excluded.
- **Generous Safe Boundary:** Expands visual ink bounds into a rounded-capsule contour with `clearX = max(20, 0.48 * H)` and `clearY = max(15, 0.38 * H)` (trimming slightly only on edges colliding with unrelated neighbor words while maintaining `>= 10px` safe clearance).
- **Cubic Bézier Puffy Lobes:** Traces `10–20` clockwise lobes along the safe boundary with seeded irregular lobe widths and outward puffs (`9.5–18` world units). `fill="none"`, continuous chalk outline (`strokeWidth = 2.9`), zero heavy fill, zero dashed rectangle.
- **Stable Seed:** Persisted `cloud_seed` computed deterministically from `hashString(stable_key)` so shapes never jitter on re-renders, pan, zoom, or reload.

### Single-Teacher Chalk Animation Engine (`WonderAiChalkOverlay`)
- **Sequential Queue:** Active annotations render strictly one at a time in pedagogical priority order (`DRAWING_CLOUD -> 240ms pause -> DRAWING_ARROW -> 240ms pause -> WRITING_CORRECTION -> WRITING_EXPLANATION`).
- **Arc-Length Slicing (`sliceCloudPathAtProgress`):** Renders ONLY open path prefixes `M p0 L p1 ... L pk` for `progress < 1` (preventing diagonal closing shortcuts across target ink), closing `Z` strictly at `100%`.
- **Chalk Tip Cursor:** Moves along the exact tangent angle `(headX, headY, headAngle)` of active strokes and disappears automatically upon completion.
- **Unicode Grapheme Safety:** Uses `Intl.Segmenter('vi', { granularity: 'grapheme' })` so progressive text reveals never split Hangul syllables or Vietnamese diacritic clusters mid-grapheme.
- **Speed & Accessibility:** `slow` (`1.35x`), `natural` (`1.0x`), `fast` (`0.45x`), `instant` (`0x`), plus `prefers-reduced-motion` compliance. Completed annotations persist `animation_progress.completed = true` so page reloads do not replay past animations.

---

## 3. Recognition Capability, Incremental Pipeline & Lifecycle (`RECOGNITION_CAPABILITY_REPORT`, `INCREMENTAL_AI_PIPELINE`, `ANNOTATION_LIFECYCLE`)

- **Strict Provenance Separation:** Strokes carry `provenance`: `'freehand_ink' | 'typed_vector' | 'fixture_sample' | 'ai_teaching' | 'imported'`. AI strokes (`'ai_teaching'`) are excluded from `segmentStrokesIntoRegions` to eliminate self-feedback loops.
- **Incomplete Korean Fragment Awareness:** Trailing bare Jamo `[ㄱ-ㅎㅏ-ㅣ]` or unfinished clause stems (`저는 어제 학교에 가`) yield `recognitionStatus: 'IN_PROGRESS'` so the AI teacher stays in `WAITING_FOR_CONTEXT` instead of prematurely marking errors.
- **Zero Fake Stroke Feedback:** Generic `"4 nét"` bubbles on `low_confidence` / `AMBIGUOUS` scribbles are completely eliminated; the AI stays silent when recognition is uncertain and never penalizes BKT/Elo (`applyWonderLearningEventsToProfile`).
- **Incremental Dirty-Region Tracking & Reconciliation V2 (`computeDirtyRegions`, `reconcileAnnotationsWithStrokes`):**
  - Moving strokes via lasso triggers `GEOMETRY_UPDATED`, shifting clouds/arrows/chalk notes without calling grammar analysis or replaying animations.
  - Editing/deleting target ink sets `INVALIDATED` (`status: 'stale'`, `lifecycle_state: 'stale'`), cancelling active animations immediately.
  - Self-corrections set `RESOLVED` and log confirmed learning events into SEED's BKT/Elo profile.

---

## 4. Security, Privacy & Performance (`SECURITY_AND_PRIVACY_REVIEW`, `PERFORMANCE_BENCHMARK`)

- **Privacy Opt-In:** Cloud LLM analysis executes only when `allowCloudAi === true` and a key is supplied; untrusted handwritten text is wrapped inside structural delimiters (`<<<...>>>`) and all responses are parsed strictly through `WonderAnnotationSchema` (Zod). No `eval` or arbitrary HTML injection is possible.
- **Production Proxy Note:** Any production release must route cloud calls through an authenticated backend proxy holding provider keys server-side with rate limiting and size caps.
- **Render / AI Decoupling:** Canvas pointer capture and midpoint quadratic Bezier rendering run in `requestAnimationFrame` independently of async recognition/LLM calls; Chalk overlay animations run inside isolated memoized `WonderAiChalkOverlay`.
- **Automated Performance Observed (Synthetic Test Benchmark V2):** Recognition + pedagogy latency on multi-sentence regions averaged `< 4ms` locally; `WONDER_BOARD` bundle `dist-web` compiled cleanly (`225` modules, `682 kB`).

---

## 5. Visual Validation Evidence (`docs/visual-evidence/`)

All 16 screenshots captured against the live served web bundle in headless Chrome (`1280x820 @ 2x` desktop + `1180x820` / `820x1180` emulated iPad viewports):
1. `01_board_before_upgrade.png` — V1 baseline prior to V2 changes (small oval cloud + white tooltip popup + dashed strokes).
2. `02_cloud_geometry_completed.png` — V2 organic cubic-Bézier cloud around `가요.` with zero fill & full ink clearance.
3. `03_cloud_animation_000.png` through `07_cloud_animation_100.png` — Verified frame progression at `0%`, `25%`, `50%`, `75%`, `100%` with moving chalk tip nib.
4. `08_animated_arrow.png` — Curved chalk arrow drawing before explanation appears.
5. `09_direct_chalk_explanation.png` — Direct-on-canvas `Gaegu` chalk correction (`가요 → 갔어요`) + Vietnamese explanation on `#F5EFE6` beige without tooltip boxes.
6. `10_multiple_errors.png` — Three independent errors (`가요 → 갔어요`, `사과가 → 사과를`, `학교에 → 학교에서`) rendered with 3 distinct clouds cleanly separated.
7. `11_incremental_n_plus_one.png` — `저는 어제 학교에 가` waits silently; completing `저는 어제 학교에 갔어요.` transitions to positive praise.
8. `12_edit_during_animation.png` — Editing target ink mid-animation cancels stale cloud immediately.
9. `13_zoom_45_percent.png` — World-to-screen transform accuracy verified at `45%` zoom.
10. `14_ipad_landscape_emulation.png` (`EMULATED`) & `15_ipad_portrait_emulation.png` (`EMULATED`).
11. `16_after_reload.png` — Reload persistence preserves strokes and completed annotations without replay.
