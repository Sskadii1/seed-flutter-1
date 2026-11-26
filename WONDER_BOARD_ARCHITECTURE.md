# SEED Wonder Board — Architecture, Audit & Specification

> Reference copy: detailed engineering specification also lives at [`docs/05-wonder-board-architecture.md`](docs/05-wonder-board-architecture.md).

## 1. Phase 0 — Repository Audit Summary

Audited workspace: `c:\Users\linhn\Downloads\SEED` (`seed-korean-monorepo`).

| Layer | Actual Stack & Findings |
|---|---|
| Package Manager & Monorepo | `pnpm` workspaces (`packages/schema`, `packages/learning-engine`, `apps/mobile`, `scripts/`) |
| Frontend Framework | Expo SDK `~52.0.0`, React `18.3.1`, React Native `0.76.9`, React Native Web `~0.19.13` (`apps/mobile`) |
| Validation & Schema | TypeScript `^5.7.2` (strict), Zod in `@seed/schema` |
| Navigation & State | Tab shell in `apps/mobile/src/App.tsx` (`learn`, `review`, `dict`, `stats`, `chat`); local-first persistence in `apps/mobile/src/store/learningStore.ts` (`localStorage` + `SUPABASE_MIGRATION_SQL` sync contract in `apps/mobile/src/lib/supabase.ts`) |
| Existing Adaptive Learning | `@seed/learning-engine`: `hangul.ts`, `fsrs.ts` (FSRS-4.5), `session.ts`, `adaptive-ai.ts` (`BKT`, `Pelanek Elo-IRT`, `Wilson 85% Rule`, `ZPDES`) |
| Legacy / Conflicting Modules | None — `NotebookScreen` or competing handwriting module does **not** exist in the current repository. |
| Baseline Verification | `pnpm typecheck` (3/3 pass), `pnpm test` (5/5 pass), `pnpm validate` (pass: 13 roadmap units, 14 Unit 1 vocab, 24 exercises). |

### Key Reused Modules
- `@seed/schema`: Extended with `packages/schema/src/wonder-board.ts` for all 6-layer data contracts, 5 chalkboard/pastel themes, and strict Zod annotation schema validation.
- `@seed/learning-engine`: Extended with `packages/learning-engine/src/wonder-board.ts` for stroke geometry, procedural Bézier scalloped clouds, curved chalk arrows, collision-free spatial placement, stroke-to-text alignment, hybrid Korean/Vietnamese/English recognition, and ambient pedagogical analysis, directly feeding `updateAdaptiveAiProfile`, `hasBatchim`, and `attachParticle`.
- `@seed/mobile`: Extended cleanly with `apps/mobile/src/screens/WonderBoardScreen.tsx` and integrated as the **`Wonder Board`** workspace view without altering existing SEED screens.

---

## 2. Six-Layer Spatial Architecture

Wonder Board enforces strict separation between ink, recognition, AI feedback, and UI overlays:

| Layer | Name | Ownership & Mutability | Stored Data |
|---|---|---|---|
| **Layer 1** | Canvas Background | User theme & camera | `themeId`, `chalkTextureEnabled`, `viewport: { offsetX, offsetY, scale }` |
| **Layer 2** | Original User Ink | **Immutable by AI** (user-only edits) | `strokes[]`: `id`, `boardId`, `points[]` (`x,y,pressure,tiltX,tiltY,t`), `tool`, `color`, `width`, `bbox`, `revision`, `deleted` |
| **Layer 3** | Semantic Recognition | Derived / cached (hidden by default) | `regions[]`: `recognizedText`, `language`, `completeness`, `confidence`, `spans[]` (`strokeIds`, `bbox`) |
| **Layer 4** | AI Annotation | AI-owned, stroke-anchored | `WonderAnnotation[]`: scalloped cloud geometry, curved chalk arrow, note coordinates, `source_revision`, `source_stroke_ids`, `status` |
| **Layer 5** | AI Teaching Content | AI-owned, free-space placed | `WonderTeachingCard[]`: beginner examples, Korean templates, traceable `ghostHandwritingText`, mini drills |
| **Layer 6** | Interaction & Selection | Ephemeral UI state | Active lasso polygon, selected stroke IDs, hover state, contextual AI gesture menu, active stylus indicator |

---

## 3. Core Engines & Data Contracts

1. **World Coordinate System (`x, y`)**: All ink strokes, bounding boxes, clouds, arrows, and teaching cards use device-independent world coordinates. Screen transforms follow `screen = world * scale + offset`.
2. **Stale Response Protection & Ink Integrity**:
   - Every ink mutation increments `board.revision`.
   - Every AI request snapshots `source_revision` and `source_stroke_ids`.
   - When strokes change or are deleted before an AI response returns, or afterward (`reconcileAnnotationsWithStrokes`), stale annotations are invalidated (`status = 'stale'`) instead of appearing at mismatched coordinates.
   - AI **never** mutates Layer 2 strokes (`Original User Ink`).
3. **Structured Output Schema (`WonderAnnotationSchema`)**:
   Frontend strictly validates every annotation with Zod (`annotation_id`, `board_id`, `source_revision`, `source_stroke_ids`, `recognized_text`, `target_text`, `target_span`, `target_geometry`, `note_geometry`, `arrow_path`, `annotation_type`, `linguistic_category`, `severity`, `confidence`, `suggested_correction`, `explanation`, `hint`, `practice_exercise`, `visual_style`, `placement_preference`, `learning_concept_ids`, `created_at`, `status`). No raw HTML or eval'd script from LLM output is ever executed.
4. **Procedural Scalloped Cloud & Curved Chalk Arrows**:
   Clouds are generated dynamically via deterministic quadratic Bézier scallops scaled around each target word's real stroke `WonderBBox` (never CSS rectangles or fixed emojis).

---

## 4. Security, Privacy & Production Proxy Assessment

- **Untrusted Canvas Input**: Handwritten text and stroke text passed to optional cloud LLMs are wrapped inside strict structural delimiters and never treated as system instructions. Output is accepted only after `WonderAnnotationSchema` parsing.
- **API Key Hygiene**: No production API key is stored in the codebase. Cloud vision/LLM calls are strictly opt-in (`allowCloudAi: true`). For production deployment, place a lightweight backend proxy (e.g., Supabase Edge Function / Cloudflare Worker) holding provider keys server-side, verifying Supabase `auth.uid()` board ownership, and enforcing per-user rate limits and payload caps (<= 64 KB changed-region strokes).
- **Local-First Deletion**: Users can permanently delete individual boards or wipe all Wonder Board state from `localStorage` immediately.

---

## 5. Known Limitations & Hardware Verification Status

- **Apple Pencil Hardware (`AC-12`)**: `NOT TESTED ON PHYSICAL DEVICE` — iPad Safari Pointer Events (`pointerType = 'pen'`, `pressure`, `tiltX`, `tiltY`, `getCoalescedEvents`, 2-finger pan/pinch, palm rejection touch guard) are implemented cleanly using web standards and verified statically via TypeScript strict checks, **not** yet exercised on physical iPad / Apple Pencil hardware.
- **Handwriting Recognition Scope (`AC-04`)**: Local recognition currently uses vector stroke decomposition + Jamo/syllable trajectory prototype matching over supported fixture vocabularies and freeform strokes, with an optional multimodal LLM vision plug-in for arbitrary cursive Hangul. Recognition accuracy metrics (`CER`, `WER`, `strokeAlignmentRate`) are reported from `evaluateKoreanRecognitionBenchmark()` in automated tests and are transparently labeled.
