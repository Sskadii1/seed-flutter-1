# SEED Wonder Board V3 — Consolidated Architecture, Benchmark & Verification Report

**Audit & Release Date:** 2026-11-26  
**Workspace:** `c:\Users\linhn\Downloads\SEED`  
**Prior Baseline:** [`WONDER_BOARD_V2_GAP_ANALYSIS.md`](WONDER_BOARD_V2_GAP_ANALYSIS.md), [`WONDER_BOARD_V2_ARCHITECTURE.md`](WONDER_BOARD_V2_ARCHITECTURE.md), [`WONDER_BOARD_V2_RELEASE_REPORT.md`](WONDER_BOARD_V2_RELEASE_REPORT.md)

---

## 1. P0 Subsystem Quality Gates (Strict Honest Classification)

| Subsystem | Status | Evidence & Honest Conditions |
| :--- | :--- | :--- |
| **`REAL_HANDWRITING_RECOGNITION`** | **`PARTIAL` (Offline Jamo) / `BLOCKED` (Live Cloud OCR)** | Offline compositional Hangul recognizer (`local-freehand-jamo`) composes open + batchim syllables (`안녕하세요.`, `사랑해요.`, `어디에 가요?`, `저는 한국어를 공부해요.`, `오늘 날씨가 좋아요.`, `고마워`, `어디야`, `나도야`) without hardcoded phrase prototypes (`V3-8`–`V3-11`). Live Vision OCR for arbitrary cursive Hangul & handwritten Vietnamese remains **`REAL_FREEHAND_RECOGNITION_BLOCKED`** offline until `GEMINI_API_KEY` or `OPENAI_API_KEY` is configured on `services/ai-gateway/server.mjs` (confirmed via `diagnostics` in Settings & `V3-12`). |
| **`CLOUD_VISUAL_QUALITY`** | **`PASS`** | Rebuilt `generateScallopedCloudGeometry` (`wonder-board.ts`) with bowed super-ellipse contour (eliminating flat top/bottom rectangle lines), asymmetric billowy cubic Bézier lobes (6–15 lobes scaled with ink height, removing 18px cap), generous padding (`44%h` horizontal, `36%h` vertical), no background fill, and rounded pastel chalk under-stroke + zoom-compensated stroke width (`>= 2.5px` at `45%–200%` zoom). |
| **`CHALK_ANIMATION`** | **`PASS`** | Verified single-stroke progressive arc-length cloud drawing (`3.2–6.8s` natural pace), arrow pause & draw, sequential chalk typography, chalk cursor tracking, and reduced-motion / no-replay preservation across pan/zoom/new strokes (`B01–B09`, `session_a`). |
| **`ANNOTATION_TYPOGRAPHY`** | **`PASS`** | Loaded `Gaegu`, `Nanum Pen Script`, and `Be Vietnam Pro` in `typography.ts` (`FONT_CHALK`), scaling correction text proportionally (`40–65%` handwriting height up to `54px`, zoom-protected min size `>= 20px`) with clean Vietnamese diacritic glyph support and no `"Xác nhận chữ viết"` cloud headers. |
| **`DEDUPLICATION`** | **`PASS`** | Canonical sorted-stroke `stable_key` + `deduplicateWonderAnnotations` eliminates left+right double notes (`고마워` strictly 1 active annotation, `V3-12`). |
| **`INCREMENTAL_ANALYSIS`** | **`PASS`** | Freehand `N -> N+1` waits silently on incomplete input (`IN_PROGRESS`), invalidates stale feedback on revision/erase, preserves valid annotations, and never spawns automatic unknown-ink `"Xác nhận chữ viết"` clouds (`V3-12`, `freehand_unknown_silent.png`). |
| **`ADAPTIVE_TUTOR`** | **`PASS`** | Verified 14 learning intents, single-word pinpoint error correction on unseen sentence (`저는 한국어가 공부해요.` -> encircles only `한국어가`), beginner micro-teaching loop, cognitive-load throttling, and idempotent BKT/Elo updates (`1025.38 -> 1025.38`). |
| **`BROWSER_VALIDATION`** | **`PASS`** | `pnpm typecheck` (3/3), `pnpm test` (`22/22` tests), `pnpm validate`, `pnpm export:web`, `15/15` V2 browser checks + V3 CDP sessions & multi-zoom (`45%–200%`) visual evidence passed. |
| **`DEVICE_VALIDATION`** | **`BLOCKED` (`NOT TESTED ON PHYSICAL DEVICE`)** | Tested via headless Chromium desktop mouse dragging (`Input.dispatchMouseEvent`) and Chromium iPad viewport emulation (`EMULATED`); physical iPad + Apple Pencil hardware has not been tested. |

---

## 2. Test Inventory Audit & V2 -> P0 Improvements

- **Test Inventory Audit (`11/11` vs `10/10` -> `22/22`):**
  - Core SEED tests (`packages/learning-engine/test/engine.test.ts`): `5/5` preserved unchanged.
  - V1 -> V2 (`packages/learning-engine/test/wonder-board.test.ts`): consolidated 6 individual tests into 5 grouped suites (Groups A–F) without dropping assertions.
  - **V3 + P0 Expansion (`packages/learning-engine/test/wonder-v3.test.ts`):** Added **12 granular V3/P0 test suites** (`22/22` passing total).
- **V2 -> V3 Gaps Addressed:**
  1. V2's `local-stroke-v2` only matched 12 hardcoded prototypes (`KNOWN_PHRASE_PROTOTYPES`), and V2's optional cloud fetch only sent pre-recognized text rather than cropped stroke images. V3 separates provenance cleanly (`freehand_ink`, `typed_vector`, `fixture_sample`, `user_confirmed`, `ai_teaching`), crops Layer 2 user ink onto clean `#FFFFFF` PNGs via `renderRegionInkCropDataUrl`, aligns Vision `bboxNorm` back onto `wordClusters` via `alignVisionWordsToStrokeClusters`, and handles `PROVIDER_UNAVAILABLE` silently without inventing fake errors.
  2. API keys were previously browser-only (`localStorage`). V3 adds a standalone Node Production Gateway (`services/ai-gateway/server.mjs`) keeping `GEMINI_API_KEY`/`OPENAI_API_KEY` strictly server-side with Bearer auth, `512 KB` body caps, `30 req/min` rate limits, `12s` timeouts, and clear `DEV-ONLY` labeling if browser keys are used directly.
  3. V2 lacked multi-region relational reasoning (`BoardContextModel`), intent diversity (`14` intents), canonical Hangul NIKL stroke order (`hangul-stroke-order.ts`), beginner micro-teaching state machines, structured Zod action budgets (`WonderBoardActionSchema`), and persistent idempotency keys preventing Elo double-counting on reload.

---

## 3. Recognition Capability Matrix & Provider Architecture

| Path / Provider | Provenance | Korean Support | Vietnamese / Mixed | Real Freehand Generalization | Failure / Uncertainty Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `seed-ai-gateway-vision` (`gemini-2.5-flash` / `gpt-4o-mini` via Gateway) | `freehand_ink` | Via Vision `image_url` + crop box mapping | Via Vision `image_url` | Supported when live key configured (unverified offline) | Returns `PROVIDER_UNAVAILABLE` (HTTP 503/network/timeout); UI stays silent, zero ink loss |
| `local-freehand-jamo` / `local-stroke-v2` (`wonder-board.ts`) | `freehand_ink` | Offline compositional Hangul Jamo/Batchim composition + non-text/in-progress classifier (`12` fallback prototypes) | 1 fallback prototype | **Partial** (composes structured freehand Hangul Jamo blocks; returns `AMBIGUOUS` on cursive/illegible or unseen handwritten Vietnamese) | Sets `AMBIGUOUS` / `IN_PROGRESS` / `NON_TEXT`; emits zero `"4 nét"` / `"Xác nhận chữ viết"` bubbles |
| `fixture-assisted-v2` / `typed-ground-truth` | `fixture_sample`, `typed_vector` | Explicit ground-truth hint text | Explicit hint text | N/A (not counted as OCR evidence) | Preserved strictly for deterministic pedagogy & layout testing |
| `user-confirmed` (`applyConfirmedUserTranscript`) | `user_confirmed` | Learner-confirmed transcript via Lasso menu | Learner-confirmed | Manual offline workaround | Never mislabeled as automatic freehand OCR |

**Production Gateway Security (`services/ai-gateway/server.mjs`):**
- Endpoints: `GET /api/wonder/health`, `POST /api/wonder/recognize`, `POST /api/wonder/tutor`.
- Controls: `SEED_GATEWAY_TOKEN` Bearer auth (`401`), sliding-window per-IP limiter (`429`), JSON payload cap `512 KB` (`413`), upstream `12s` `AbortController` timeout (`503`), strict schema & action allowlist filtering (`DRAW_CLOUD`, `WRITE_EXPLANATION`, `WRITE_EXAMPLE`, `DRAW_CHECKMARK`, `WAIT`), and separation of untrusted student text from system prompts. **Secrets are never bundled into `dist-web`.**

---

## 4. Spatial Context, Tutor Protocol & Adaptive Learning Specs

- **Board Context (`packages/learning-engine/src/wonder-context.ts`):** Builds `WonderBoardContext` linking regions via `linked_by_arrow`, `self_correction_candidate`, `answer_to_ai_card`, `continuation_below`, `marginal_note`, or keeping unrelated regions `independent` rather than flattening the canvas into one string.
- **Learning Intent Engine & Orchestrator (`packages/learning-engine/src/wonder-tutor.ts`):** Classifies all **14 intents** (`FREE_PRACTICE`, `ASK_TRANSLATION`, `ASK_GRAMMAR`, `ASK_MEANING`, `ASK_PRONUNCIATION`, `ASK_HOW_TO_WRITE`, `LEARN_NEW_TOPIC`, `PRACTICE_HANGUL`, `PRACTICE_VOCABULARY`, `PRACTICE_SENTENCE`, `SELF_CORRECTION`, `ANSWER_AI_EXERCISE`, `FREE_DRAWING`, `UNKNOWN_INTENT`) with confidence & evidence. Executes semantic planning into Zod-validated `WonderBoardAction` objects, applies `guidanceLevel` throttling (`minimal: 1`, `beginner_friendly: 1`, `guided: 2`, `detailed: 4`), and preserves overflow errors inside `deferredActions` (`max 12`).
- **Canonical Hangul Stroke Order (`packages/learning-engine/src/hangul-stroke-order.ts`):** Decomposes all 40 base Jamo into NIKL stroke sequences and composes all `11,172` modern syllables (`\uAC00–\uD7A3`) with numbered stroke starts (`1, 2, 3...`), ghost guides, and arc-length slicing (`sliceHangulDemoAtProgress`).
- **Evidence-Based Self-Correction & Idempotent BKT/Elo (`packages/learning-engine/src/wonder-board.ts`, `apps/mobile/src/store/learningStore.ts`, `apps/mobile/src/App.tsx`):** Resolves prior errors only on shared semantic roots + valid correction (`evaluateSelfCorrectionEvidence`), separates `exposure`, `copied_answer`, `guided_self_correction`, and `independent_usage`, and deduplicates confirmed events via persistent `recordedWonderEventKeys`.

---

## 5. Stratified Benchmark V3 Results (`evaluateWonderBoardBenchmarkV3`)

Observed directly in `pnpm test` (`V3-7`):

| Dataset | Scope & Explicit Label | Observed Result |
| :--- | :--- | :--- |
| **Dataset A** (`datasetA_syntheticRegression`) | V2 synthetic regression fixtures only (6 sentences — NOT human OCR) | `cer: 0`, `wer: 0`, `strokeAlignmentAccuracy: 1`, `nonTextRejectionAccuracy: 1` |
| **Dataset B** (`datasetB_realHumanFreehand`) | Real human multi-writer Korean/Vietnamese corpus | **`NOT_AVAILABLE`** (`sampleCount: 0`) |
| **Dataset C1** (`unseenHandwriting`) | Open-vocabulary unseen human handwriting | **`NOT_MEASURED_OFFLINE`** (`sampleCount: 0`, requires live Vision API key) |
| **Dataset C2** (`unseenLinguisticAnalysis`) | 6 unseen Korean & Vietnamese linguistic cases | `intentClassificationAccuracy: 1.0 (6/6)`, `precision: 1.0`, `recall: 1.0`, `falseAnnotationRate: 0` |
| **Dataset D** (`datasetD_negativeInputs`) | 4 negative cases (circle doodle, single dot, incomplete verb `가`, random freehand strokes) | `unknownRejectionRate: 1.0 (4/4)`, `falseAnnotationRate: 0` |
| **Dataset E** (`datasetE_continuousSessions`) | Interactive 5-step sequence `N -> N+1 -> N+2 -> edit -> erase -> rewrite` | `duplicateAnnotationRate: 0`, `staleAnnotationRate: 0`, `selfCorrectionAccuracy: 1.0`, `idempotentEventAccuracy: 1.0` |

---

## 6. Performance Breakdown & API Cost

- **Browser Canvas & Local Pipeline (observed in test/runtime telemetry):**
  - Unit & integration engine benchmark suite (`22` tests total across `engine.test.ts`, `wonder-board.test.ts`, `wonder-v3.test.ts`): `1750.09 ms` total; synthetic local recognition + linguistic orchestration executes in `< 20 ms` locally (`lastSegmentationMs`, `lastLocalRecognitionMs`, `lastLinguisticAnalysisMs` tracked separately in `WonderTelemetryMetrics`).
  - **Cloud Vision Latency & Per-Session Cost:** **`NOT_MEASURED`** (no live external provider key / metered usage in offline sandbox; `AbortController` request cancellation, `WonderRecognitionCache` 64-entry LRU hash dedupe, and per-region dirty tracking prevent per-pointer-event API calls).

---

## 7. Phase 0 + Continuous Browser Sessions A–G Evidence (`docs/visual-evidence-v3/`)

All 15 V2 browser screenshots (`verify-wonder-board-v2-browser.mjs`) AND all 7 V3 continuous sessions (`verify-wonder-board-v3-sessions.mjs` against served `dist-web` + live `services/ai-gateway/server.mjs` + headless Chrome CDP) passed (`trace`: [`session-trace.json`](docs/visual-evidence-v3/session-trace.json)):

1. **Phase 0 + Session D** ([`phase0_session_d_freehand_silent.png`](docs/visual-evidence-v3/phase0_session_d_freehand_silent.png)): Real mouse-drag (`Input.dispatchMouseEvent`) freehand strokes (`2` strokes captured); AI stays `Đang quan sát` with `0` fake error clouds.
2. **Session E — API / Gateway Unavailable** ([`session_e_gateway_unavailable.png`](docs/visual-evidence-v3/session_e_gateway_unavailable.png)): Board configured against live `services/ai-gateway/server.mjs` returning HTTP `503 PROVIDER_UNAVAILABLE`; strokes intact (`2`), zero crashes, zero fake feedback, `regions[0].recognitionStatus === 'PROVIDER_UNAVAILABLE'`.
3. **Session A — Continuous Writing During Active Cloud Animation** ([`session_a_continuous_writing.png`](docs/visual-evidence-v3/session_a_continuous_writing.png)): Learner writes `저는 사과가 먹어요.` mid-animation while `가요.` cloud is drawing; both errors queue sequentially (`가요`, `사과가`) without replaying finished items.
4. **Session B — Zero-Knowledge Beginner Micro-Teaching Loop** ([`session_b_beginner_loop.png`](docs/visual-evidence-v3/session_b_beginner_loop.png)): Vietnamese goal (`Tôi muốn học cách giới thiệu bản thân.`) triggers Step 1 teaching card (`안녕하세요.` + Step 2 template `저는 [tên bạn] 이에요/예요.`), then catches learner's attempt `저는 학생예요.` with organic pink chalk cloud `학생예요 → 학생이에요`.
5. **Session C — Context Revision** ([`session_c_context_revision.png`](docs/visual-evidence-v3/session_c_context_revision.png)): Changing `어제` to `오늘` retracts stale tense annotation cleanly (`0` active errors remaining).
6. **Session F & G — Evidence-Based Self-Correction & Reload Idempotency** ([`session_f_self_correction.png`](docs/visual-evidence-v3/session_f_self_correction.png), [`session_g_reload_idempotent.png`](docs/visual-evidence-v3/session_g_reload_idempotent.png)): Writing `저는 학생이에요.` resolves the prior error with green check + `잘했어요!`, updates learner Elo once (`1025.3785`), and preserves exact strokes, completed annotations, and Elo (`1025.3785`) across page reload + re-analysis.
7. **Freehand Compositional Hangul Verification** ([`freehand_large_a_explained.png`](docs/visual-evidence-v3/freehand_large_a_explained.png), [`freehand_gomawo_explained.png`](docs/visual-evidence-v3/freehand_gomawo_explained.png), [`freehand_eodiya_nadoya_explained.png`](docs/visual-evidence-v3/freehand_eodiya_nadoya_explained.png)): Mouse-dragged freehand `아`, `고마워`, and diagonal `어디야` + `나도야` are segmented accurately, recognized offline via geometric compositional Jamo analysis, annotated once inside billowy super-ellipse organic clouds without duplicate notes, and rendered with adaptive handwritten chalk typography.
8. **P0 Quality Gate Evidence** ([`freehand_unknown_silent.png`](docs/visual-evidence-v3/freehand_unknown_silent.png), [`freehand_unseen_error_pinpointed.png`](docs/visual-evidence-v3/freehand_unseen_error_pinpointed.png), [`zoom_45_percent_check.png`](docs/visual-evidence-v3/zoom_45_percent_check.png), [`zoom_150_percent_check.png`](docs/visual-evidence-v3/zoom_150_percent_check.png)): Illegible strokes emit zero `"Xác nhận chữ viết"` clouds, unseen freehand error `저는 한국어가 공부해요.` pinpoints only `한국어가`, and billowy cloud strokes + text remain clear across `45%–200%` zoom levels.

---

## 8. Known Limitations

1. Real open-vocabulary freehand Korean/Vietnamese OCR cannot run live without providing a `GEMINI_API_KEY` or `OPENAI_API_KEY` on `services/ai-gateway/server.mjs`.
2. Visual vector stroke synthesis (`generateHandwrittenStrokesForText`) draws structured Hangul Jamo blocks clearly but uses deterministic geometric curves for Latin/Vietnamese fixture tokens when offline visual samples are inserted via `"Mẫu thử"`.
3. Physical Apple Pencil latency, palm rejection ergonomics, and iPadOS Safari memory limits require physical device validation (`NOT TESTED ON PHYSICAL DEVICE`).
