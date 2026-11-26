# SEED Wonder Board — Technical Architecture, Pipeline & Design System

## 1. Existing Repository Audit (Phase 0)

| Aspect | Observed State in Repository |
|---|---|
| Workspace Layout | `pnpm-workspace.yaml`: `packages/*`, `apps/*` |
| Shared Packages | `@seed/schema` (`packages/schema`), `@seed/learning-engine` (`packages/learning-engine`) |
| App Runtime | `@seed/mobile` (`apps/mobile`): Expo `~52.0.0`, React `18.3.1`, React Native `0.76.9`, React Native Web `~0.19.13` |
| Existing Screens | `LearnMapScreen`, `ReviewQueueScreen`, `DictionaryScreen`, `RetentionDashboardScreen`, `AiTutorScreen`, `LessonPlayerModal` |
| Existing Adaptive AI | `adaptive-ai.ts`: 5 Knowledge Components (`kc_phonetics_3way`, `kc_phonetics_vowel_batchim`, `kc_morph_particles`, `kc_lexicon_hanja`, `kc_productive_orthography`) tracked via BKT + Pelanek Elo-IRT + ZPDES; spaced repetition via FSRS-4.5 (`fsrs.ts`) |
| Existing Persistence | `learningStore.ts` (`localStorage` local-first) + `supabase.ts` DDL with RLS & idempotent `client_attempt_id` |
| Conflicting Modules | Verified zero existing `NotebookScreen` or competing handwriting module |
| Baseline Checks | `pnpm typecheck` OK, `pnpm test` (`5/5` pass), `pnpm validate` OK (`13` roadmap units, `14` Unit 1 vocab, `24` exercises) |

---

## 2. Design System, Typography & Themes

### Commercial-Friendly Typography (Google Fonts — SIL OFL 1.1)
- **Hangul Handwriting / Chalk Labels**: `Gaegu` & `Nanum Pen Script` (full Hangul syllable coverage, hand-drawn feel)
- **Readable Korean Fallback**: `Noto Sans KR`
- **Vietnamese Explanation & UI**: `Be Vietnam Pro`

### Five Canvas Themes (`WONDER_BOARD_THEMES`)

| Theme ID | Label | Canvas BG | Primary Ink | Correction | Suggestion | Positive | Support |
|---|---|---|---|---|---|---|---|
| `cozy-green-chalkboard` (default) | Cozy Green Chalkboard | `#1E352B` | `#F9F6EC` | `#FFB5C2` | `#FFE699` | `#A8E6CF` | `#A9DEF9` |
| `classic-dark-chalkboard` | Classic Dark Chalkboard | `#23272A` | `#F4F5F7` | `#FFA8B8` | `#FFE08A` | `#9CE5C0` | `#9BD2F5` |
| `soft-cream-whiteboard` | Soft Cream Whiteboard | `#FAF6EE` | `#2B303A` | `#D95C78` | `#B87A14` | `#2F7A52` | `#2E6EA6` |
| `lavender-dream` | Lavender Dream | `#2B253A` | `#F6F2FF` | `#FFB3D1` | `#FFE6A7` | `#A7E8CC` | `#AED6FF` |
| `pastel-mint` | Pastel Mint | `#213B39` | `#F4FBF8` | `#FFB8C6` | `#FFE89E` | `#A8ECCB` | `#A6DDF5` |

---

## 3. Handwriting Recognition Pipeline (Section 9 & AC-04)

1. **Changed-Region Aggregation**: When user stops drawing for `idleDebounceMs` (default `1200ms`, skipped in `focus` mode), Layer 2 strokes are partitioned cleanly without blocking canvas input.
2. **Spatial Region Segmentation**: `segmentStrokesIntoRegions()` groups strokes vertically into writing lines and horizontally into word clusters based on inter-stroke horizontal gap heuristics. Each cluster is classified as `'complete'`, `'in_progress'` (single tentative short stroke cluster), or `'non_text'` (dense overlapping scribble / giant frame border).
3. **Hybrid Recognition Abstraction**: `recognizeHandwritingRegions()` supports pluggable providers:
   - **Local Prototype & Feature Recognizer** (`local-stroke-v1`): matches normalized 2D trajectory descriptors & character-count sub-clusters against ground-truth stroke signatures, assigning stroke IDs (`source_stroke_ids`) and world bounding boxes per token (`spans[]`). Works completely offline (`AC-10`).
   - **Optional Multimodal Cloud Provider** (`cloud-vision`, opt-in only): serializes cropped changed-region SVG/PNG bitmap + stroke cluster metadata to a user/proxy endpoint for freeform cursive Hangul/Vietnamese/English transcription when explicitly enabled.
4. **Alignment Integrity**: Word bounding boxes are derived directly from segmented stroke clusters (not string length ratios). Low-confidence outputs (`< 0.62`) never assert hard errors.

---

## 4. Spatial Annotation & Ambient AI Pipeline (Sections 10–15)

Pipeline: `Ink Mutation` -> `Idle Debounce (1.2s)` -> `Region Segmentation` -> `Recognition` -> `Linguistic & Pedagogical Rules (+ Optional LLM)` -> `Zod Schema Validation` -> `Collision-Free World Placement` -> `Non-Destructive Layer 4 & Layer 5 Rendering`.

### Supported Pedagogical Rules & Scenarios
- **Scenario A (Tense mismatch)**: `저는 어제 학교에 가요.` -> highlights `가요` strokes with pastel pink scalloped cloud + chalk arrow + `가요 -> 갔어요` + `"어제 có nghĩa là hôm qua. Trong câu này, hãy sử dụng thì quá khứ nhé!"`. Allows valid present contexts (`저는 오늘 학교에 가요.`).
- **Scenario B (Particle usage & batchim)**:
  - `저는 사과가 먹어요.` -> highlights `사과가` -> `사과를` (transitive object marker vs subject marker; avoids false positive on `사과가 맛있어요.`).
  - Batchim particle allomorphy via `@seed/learning-engine` `hasBatchim` & `attachParticle`: `저은` -> `저는`, `이름는` -> `이름은`, `학생예요` -> `학생이에요`.
- **Scenario C (Complete beginner)**: Vietnamese intent such as `"Tôi muốn học cách gọi cà phê."` spawns a Layer 5 Teaching Card in unoccupied canvas space with `커피 한 잔 주세요.`, meaning breakdown, and traceable Ghost Handwriting (`layer 5`).
- **Scenario D (Lasso AI Gesture)**: Explicit `ai_lasso` mode lets users circle any strokes to trigger Explain, Translate, Grammar Check, Example, Ghost Trace, or Mini Exercise without mistaking decorative circles drawn with regular pens for AI triggers.
- **Scenario E (Positive Feedback & Self-Correction)**: When prior flagged phrases are rewritten correctly elsewhere on the board, Layer 4 marks the prior annotation `'resolved'` (preserving original strokes untouched) and places a subtle pastel green checkmark + `잘했어요!`.

### Five AI Intervention Modes
1. `gentle` (Default): only high-confidence corrections (`>= 0.85`), compact cloud highlight until tapped.
2. `tutor`: full cloud + arrow + concise inline Vietnamese note.
3. `discovery`: proactively adds vocabulary/example Teaching Cards alongside beginner writing.
4. `focus`: AI paused completely while user writes uninterrupted.
5. `review`: on-demand full-board synthesis and learning recommendations.

---

## 5. Adaptive Learning Integration (Section 14)

Every Wonder Board session records typed `WonderLearningEvent` records (`concept_encountered`, `grammar_error_observed`, `hint_requested`, `correction_attempted`, `self_correction_completed`, `repeated_error`, `successful_independent_usage`, `exercise_completed`, `recognition_uncertainty`). Confirmed self-corrections and completed mini-drills feed into SEED's `updateAdaptiveAiProfile`, ensuring unconfirmed recognition errors never pollute BKT/Elo mastery scores.

---

## 6. Performance, Cost Control & Deployment

- **Rendering vs AI Separation**: HTML5 Canvas repaints immediately on pointer move via direct imperative drawing context + `requestAnimationFrame` scheduling without triggering React state updates per move event; state commits occur on `pointerup` / gesture commit.
- **Telemetry**: `WonderTelemetryMetrics` records `lastRenderFrameMs`, `lastRecognitionLatencyMs`, `lastAiLatencyMs`, `apiCallCount`, `estimatedTokens`, and `errorCount`.
- **Deployment**:
  - `pnpm typecheck` — strict TypeScript check across all 3 packages.
  - `pnpm test` — runs engine + Wonder Board acceptance suites.
  - `pnpm export:web` — produces static production bundle in `apps/mobile/dist-web` ready for Vercel / Netlify / Cloudflare Pages.
  - Production AI proxy should sit behind `/api/wonder-board/analyze` with JWT validation and per-user rate limits before deploying Cloud AI at scale.
