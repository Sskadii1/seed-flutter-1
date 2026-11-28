# Third-Party Notices and Upstream Audit Attribution

SEED Wonder Board incorporates selected, cleanly adapted concepts and algorithms from MIT-licensed open-source projects audited locally at exact pinned commits. All upstream licenses are preserved below.

---

## 1. MaximeRivest/riddle

- **Repository:** https://github.com/MaximeRivest/riddle
- **Audited Commit:** `0d1a9feea75027543e2ed49c721656cd261f03a1`
- **License:** MIT License
- **What SEED Adapted (clean TypeScript / JS re-implementations):**
  - Clean foreground-ink PNG snapshot export concept (`src/ink.rs` `to_png`) -> adapted as `renderObservationWindowSnapshot` (`apps/mobile/src/lib/wonderGateway.ts`) using zoom-independent world coordinates and Layer 2 ink isolation. Original user ink is NEVER dissolved or erased.
  - `IDLE_COMMIT = 2800ms` upper cadence ceiling and `--oracle-test [PNG]` standalone PoC probe -> adapted into `computeAdaptiveAnalysisDelayMs` and `scripts/probe-vision-poc.mjs`.
  - HTTP 400 automatic `max_tokens` -> `max_completion_tokens` compatibility retry (`src/oracle.rs`) -> adapted into `api/_shared.mjs` and `services/ai-gateway/server.mjs`.
  - Stroke point decimation and bounded rolling conversation memory (`src/memory.rs`) -> adapted as `decimateStrokePoints` and `appendConversationMemoryTurn` (`packages/learning-engine/src/wonder-perception.ts`).
  - Zhang-Suen 2-phase thinning & endpoint-first skeleton polyline tracing (`src/script.rs`) -> ported as `thinZhangSuen`, `traceSkeletonStrokes`, `synthesizeHandwritingFromMask` (`packages/learning-engine/src/wonder-handwriting-synth.ts`) paired with SEED fonts (`Gaegu`, `Playpen Sans`) and automatic grapheme-reveal fallback.
- **Explicitly Rejected:** reMarkable hardware / framebuffer / evdev / power modules (`src/fb.rs`, `src/pen.rs`, `src/touch.rs`, `src/power.rs`, `src/qtfb.rs`, `src/display.rs`), Tom Riddle persona, `dissolve_pass` ink deletion, and `fonts/DancingScript.ttf`.

```text
MIT License

Copyright (c) 2026 Maxime Rivest

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. farhan-beg/riddle-web

- **Repository:** https://github.com/farhan-beg/riddle-web
- **Audited Commit:** `e3fabc6522fae64a3bf08a55f3ead26949f321d1`
- **License:** MIT License
- **What SEED Adapted (clean TypeScript / JS re-implementations):**
  - Multi-provider failover ordering on rate-limit / upstream error (`src/worker.js`) -> adapted into `resolveVisionUpstreams` and `callOpenAiCompatibleWithFallback` (`api/_shared.mjs`) with an explicit hostname allowlist.
  - Browser `ReadableStream` SSE delta parser ignoring reasoning fields (`src/index.html`) -> adapted into `parseSseActionStream` (`apps/mobile/src/lib/wonderGateway.ts`) with Zod action validation and stale-revision filtering.
- **Explicitly Rejected (Security):** `src/worker.js` `handleProxy` (unauthenticated open SSRF proxy forwarding `Authorization` to arbitrary client URLs) and `localStorage` persistence of production API keys (`src/index.html`).

```text
MIT License

Copyright (c) 2026 F4bC0d3

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 3. Offblink/Riddle-- (Audited & Rejected)

- **Repository:** https://github.com/Offblink/Riddle--
- **Audited Commit:** `3f4c79db32127e33325be7d594cb937c9070788d`
- **License:** MIT License
- **Audit Decision:** **REJECTED — zero code integrated into SEED.** Its core stroke recognition posts raw coordinate vectors to the undocumented `google.com.tw/inputtools/request` web service (adapted from `ChenYuHo/handwriting.js`), which lacks official SLA, public API terms, bounding-box alignment, and contextual multi-language understanding.

---

## 4. Typography / Fonts Used by SEED Wonder Board

- `Gaegu` (Korean handwriting chalk font) — SIL Open Font License 1.1
- `Playpen Sans` (Vietnamese & English handwriting chalk font) — SIL Open Font License 1.1
- `Noto Sans KR` / `Be Vietnam Pro` (Clean UI fallback fonts) — SIL Open Font License 1.1
