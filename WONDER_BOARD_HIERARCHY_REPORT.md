# SEED Wonder Board — Adaptive Hierarchical Handwriting & Contextual Intelligence Report

> **Deployment Status:** Local-only build & verification (`http://localhost:4173`). Live Vercel deployment (`seed-wonder-board.vercel.app`) was intentionally left untouched pending local review.

---

## 1. Phase 0 Reality Audit — Root Causes Identified in Prior Pipeline

Direct audit of `packages/schema/src/wonder-board.ts`, `packages/learning-engine/src/wonder-board.ts`, `packages/learning-engine/src/wonder-tutor.ts`, `packages/learning-engine/src/wonder-context.ts`, and `apps/mobile/src/screens/WonderBoardScreen.tsx` identified five concrete root causes behind syllable-level fragmentation:

1. **Fixed-pixel clustering thresholds:** `segmentStrokesIntoRegions` previously used fixed pixel cutoffs (`44px`, `36px`, `120px`), which either over-merged small annotations next to large glyphs or split widely spaced words (`scaleDiff` not normalized locally).
2. **Flat region representation:** Regions carried flat `spans`/`characterSpans` without a hierarchical tree connecting Hangul Jamo/syllables (`Level 2–3`) -> eojeols/words (`Level 4–5`) -> sentences (`Level 7`) -> paragraphs (`Level 8`) -> board context (`Level 9`).
3. **Practice-list over-firing (`isPracticeList`):** Excessively spaced single words (`학 교 에`) or multi-syllable spaced sentences (`저 는 한 국 어 를 공 부 해 요.`) satisfied `reg.spans.every(...)` and emitted separate per-syllable clouds instead of unifying into word/sentence feedback.
4. **Missing Korean spacing-aware decoding (Cases A–E):** Unspaced sentences (`저는한국어를공부해요.`) and over-spaced sentences (`저 는 한 국 어 를 공 부 해 요.`) lacked a DP eojeol segmenter that separates lexical decoding from raw learner error preservation.
5. **No P0 parent-child annotation retraction or adaptive debounce:** When `사` expanded progressively to `사랑 -> 사랑해 -> 사랑해요`, the earlier `사` explanation cloud remained active (`status: 'active'`), and pointer debounce was a static `1100ms`.

---

## 2. Architecture & Changes Implemented (Local Workspace)

### 2.1 Hierarchical Representation (`Level 0–9`) & Schema
- Added `WonderSemanticNodeLevel`, `WonderCompletionStatus`, `WonderInterventionGranularity`, `WonderSpacingIssue`, `WonderSpacingHypothesis`, `WonderNormalizedSpacingFeatures`, `WonderSemanticNode`, and `WonderSemanticTree` to [wonder-board.ts (schema)](file:///c:/Users/linhn/Downloads/SEED/packages/schema/src/wonder-board.ts).
- Extended `WonderBoardDocument` with optional `semanticTree` and `WonderAnnotation` with `granularity`, `parent_node_id`, and `retracted_reason`.
- Preserved `semanticTree` cleanly in [wonderBoardStore.ts](file:///c:/Users/linhn/Downloads/SEED/apps/mobile/src/lib/wonderBoardStore.ts).

### 2.2 Local Scale Estimation, Spacing Decoder & Semantic Reconciliation
Created [wonder-hierarchy.ts](file:///c:/Users/linhn/Downloads/SEED/packages/learning-engine/src/wonder-hierarchy.ts) and re-exported from [index.ts](file:///c:/Users/linhn/Downloads/SEED/packages/learning-engine/src/index.ts):
- **`estimateLocalHandwritingScale` & `computeNormalizedSpacingFeatures` & `shouldGroupAdjacentUnits`:** Normalizes horizontal gaps, vertical offsets, overlap ratio, baseline alignment, temporal proximity, and `relativeScaleDifference` against local median glyph height rather than global board dimensions.
- **`segmentStrokesIntoRegions`** in [wonder-board.ts](file:///c:/Users/linhn/Downloads/SEED/packages/learning-engine/src/wonder-board.ts): Uses local band scale (`Math.max(120, localBandScale * 1.95)`) for X-column splits and guards multi-stroke glyph scale differences without splitting internal Hangul batchim/vowel strokes.
- **`decodeKoreanSpacingHypotheses`:** Dynamic-programming Korean eojeol segmenter supporting Case A (normal), Case B (`missing_spaces`), Case C (`excessive_spaces`), and Case D/E separation while preserving raw learner particle/tense errors verbatim (e.g. `저는사과가먹어요.` retains `사과가`).
- **`buildHierarchicalSemanticTree` & `selectInterventionGranularity`:** Constructs live semantic trees up to Level 8 (`paragraph`) and Level 9 (`board_context`), assigning `CHARACTER`, `WORD`, `SENTENCE`, or `SILENT_OBSERVE`.
- **`reconcileSemanticAnnotations` (P0):** Retracts child `CHARACTER`/explanation clouds (`status: 'stale'`, `lifecycle_state: 'cancelled'`, `reconciliation_action: 'SUPERSEDED'`) when strokes absorb into larger parents (`사 -> 사랑 -> 사랑해 -> 사랑해요`) and invalidates active errors that disappear after learner edits.
- **`computeAdaptiveAnalysisDelayMs`:** Adapts debounce timing based on stroke cadence and trailing incomplete Hangul Jamo.

### 2.3 Tutor Orchestration & UI Synchronization
- Updated [wonder-tutor.ts](file:///c:/Users/linhn/Downloads/SEED/packages/learning-engine/src/wonder-tutor.ts) (`orchestrateWonderTutor`): builds `semanticTree`, runs `reconcileSemanticAnnotations`, skips `SILENT_OBSERVE` nodes, suppresses `isPracticeList` per-syllable clouds whenever a higher-level Case B/C hypothesis applies, merges `학 교 에` into a single `WORD` cloud `학교에`, and attaches `granularity` + `parent_node_id` to emitted annotations.
- Updated [WonderBoardScreen.tsx](file:///c:/Users/linhn/Downloads/SEED/apps/mobile/src/screens/WonderBoardScreen.tsx): integrates adaptive timing in `handlePointerUp`, cleans `pauseAccRef` alongside `timingsRef` in `WonderAiChalkOverlay`, applies `retractedAnnotationIds`, persists `semanticTree`, skips `SILENT_OBSERVE` regions for `/api/wonder/tutor`, and exposes `window.__WONDER_BOARD_TEST__.getSemanticTree`.

---

## 3. Verification Results (All Executed After Final Edits)

| Check | Result | Scope & Details |
| :--- | :--- | :--- |
| Emoji Scan (`check-emojis.mjs`) | **PASS** | `ZERO_EMOJIS_OK` across `apps/mobile/src/**/*.{ts,tsx}` |
| TypeScript (`pnpm typecheck`) | **PASS** | `packages/schema`, `packages/learning-engine`, `apps/mobile` (`0` errors) |
| Unit Tests (`pnpm test`) | **PASS (32/32)** | `engine.test.ts`, `wonder-board.test.ts`, `wonder-v3.test.ts`, [wonder-hierarchy.test.ts](file:///c:/Users/linhn/Downloads/SEED/packages/learning-engine/test/wonder-hierarchy.test.ts) (Scenarios 1–12 + Benchmark V2/V3) |
| Domain Simulation (`pnpm validate`) | **PASS** | `ALL VALIDATION & SIMULATION CHECKS PASSED` |
| Local Web Export (`pnpm export:web`) | **PASS** | Built `apps/mobile/dist-web` (`index-1b79d47f5f203e5a56ad36b7441cf28e.js`) |
| Browser Regression (`verify-wonder-board-v3-sessions.mjs`) | **PASS** | `ALL V3 CONTINUOUS SESSIONS A-G PASSED & SAVED.` |
| Browser Hierarchy (`verify-wonder-board-hierarchy.mjs`) | **PASS** | `ALL HIERARCHICAL WONDER BOARD BROWSER CHECKS PASSED.` |

### Browser Trace Summary (`hierarchy-trace.json`)
- **T1 (`사`):** 1 active `CHARACTER` cloud (`사`).
- **T2–T4 (`사랑 -> 사랑해 -> 사랑해요`):** `사` retracted cleanly (`staleCount` incremented `1 -> 2 -> 3`); active clouds remained `[사랑]`, `[사랑해]`, `[사랑해요]` with 0 child spam.
- **H2 Freehand Progressive Sentence (`저는 한국어가 공부해요.`):** Emitted exact 1 targeted `SENTENCE` error cloud (`한국어가`), grouped into `paragraph` node.
- **H3 Case C (`저 는 한 국 어 를 공 부 해 요.`):** Decoded to `저는 한국어를 공부해요.`, `perCharSpam: 0`, `activeCount: 0`.
- **H4 Targeted Sentence (`저는 어제 학교에서 사과가 먹어요.`):** Exact 2 `SENTENCE` error clouds (`사과가->사과를`, `먹어요->먹었어요`).
- **H5 Zoom Check (`25%, 45%, 100%, 200%`):** Cloud stroke width `>= 2.2` and chalk correction font size `>= 18` verified in DOM.

---

## 4. Honest Benchmark Provenance & Known Boundaries

- **Synthetic & Controlled Freehand (`datasetProvenance: 'synthetic_and_freehand_controlled'`):** In controlled unit scenarios 1–12 (`wonder-hierarchy.test.ts`), observed `redundantAnnotationRate = 0`, `incorrectGranularityRate = 0`, `falseMergeRate = 0`, and `falseSplitRate = 0`.
- **Real Human Freehand (`realHumanFreehandStatus: 'NOT_MEASURED_IN_UNIT_BENCHMARK'`, `datasetB_realHumanFreehand: 'NOT_AVAILABLE'`):** Arbitrary messy freehand writing outside the local Hangul Jamo templates depends on an active cloud Vision/Tutor provider (`/api/wonder/vision` and `/api/wonder/tutor`).
- **Adjacent-word cloud proximity:** On tightly spaced multi-error sentences (e.g. adjacent words `사과가 먹어요.` in `targeted_errors.png`), individual target ink highlight clouds sit directly adjacent around their respective words while their explanation cards remain separated below without overlap.
