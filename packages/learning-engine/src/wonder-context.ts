import {
  WonderAnnotation,
  WonderBoardContext,
  WonderRecognitionRegion,
  WonderRegionRelation,
  WonderStroke,
  WonderTeachingCard,
} from '@seed/schema';
import { boxesIntersect } from './wonder-board';

function normalizeKoreanVerbOrNounRoot(text: string): string[] {
  return text
    .replace(/[.!?]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/(은|는|이|가|을|를|에서|에|이에요|예요|아요|어요|았어요|었어요)$/, ''));
}

function findConnectorArrowStrokes(
  strokes: WonderStroke[],
  regions: WonderRecognitionRegion[]
): WonderRegionRelation[] {
  const assignedIds = new Set(regions.flatMap((r) => r.strokeIds));
  const freeConnectors = strokes.filter(
    (s) =>
      !s.deleted &&
      s.provenance !== 'ai_teaching' &&
      !assignedIds.has(s.id) &&
      s.points.length >= 2
  );

  const relations: WonderRegionRelation[] = [];
  for (const st of freeConnectors) {
    const startPt = st.points[0];
    const endPt = st.points[st.points.length - 1];
    const len = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);
    if (len < 30) continue;

    const startBox = {
      minX: startPt.x - 18,
      minY: startPt.y - 18,
      maxX: startPt.x + 18,
      maxY: startPt.y + 18,
      width: 36,
      height: 36,
    };
    const endBox = {
      minX: endPt.x - 18,
      minY: endPt.y - 18,
      maxX: endPt.x + 18,
      maxY: endPt.y + 18,
      width: 36,
      height: 36,
    };

    const fromReg = regions.find((r) => boxesIntersect(r.bbox, startBox, 12));
    const toReg = regions.find((r) => r.regionId !== fromReg?.regionId && boxesIntersect(r.bbox, endBox, 12));
    if (fromReg && toReg) {
      relations.push({
        id: `rel_arrow_${fromReg.regionId}_${toReg.regionId}`,
        fromRegionId: fromReg.regionId,
        toRegionId: toReg.regionId,
        relationType: 'linked_by_arrow',
        confidence: 0.86,
        evidence: [`Connector stroke ${st.id} spans ${fromReg.regionId} -> ${toReg.regionId}`],
      });
    }
  }
  return relations;
}

/**
 * Spatial Document Understanding (Section 6):
 * Builds structured relationships across freeform canvas regions without flattening
 * the entire board into one string or assuming proximity alone proves co-membership.
 */
export function buildBoardContextModel(params: {
  boardId: string;
  revision: number;
  regions: WonderRecognitionRegion[];
  strokes: WonderStroke[];
  existingAnnotations: WonderAnnotation[];
  existingTeachingCards: WonderTeachingCard[];
}): WonderBoardContext {
  const {
    boardId,
    revision,
    regions,
    strokes,
    existingAnnotations,
    existingTeachingCards,
  } = params;

  const relations: WonderRegionRelation[] = [];
  relations.push(...findConnectorArrowStrokes(strokes, regions));

  const sortedByTime = [...regions].sort((a, b) => a.recognizedAt - b.recognizedAt);

  for (let i = 0; i < sortedByTime.length; i++) {
    const reg = sortedByTime[i];
    if (reg.completeness === 'non_text' || reg.completeness === 'low_confidence') {
      continue;
    }

    // 1. Check self-correction candidate against active error annotations in DIFFERENT regions
    const regRoots = new Set(normalizeKoreanVerbOrNounRoot(reg.recognizedText));
    for (const ann of existingAnnotations) {
      if (ann.status !== 'active' || ann.severity !== 'error') continue;
      const inSameRegion = ann.source_stroke_ids.some((id) => reg.strokeIds.includes(id));
      if (inSameRegion) continue;

      const annRoots = normalizeKoreanVerbOrNounRoot(ann.recognized_text);
      const sharedRoots = annRoots.filter((rt) => regRoots.has(rt));
      const directMatch =
        ann.suggested_correction.length > 0 &&
        reg.recognizedText.includes(ann.suggested_correction);

      if (directMatch && sharedRoots.length >= 1) {
        const originRegion = sortedByTime.find((r) =>
          ann.source_stroke_ids.some((id) => r.strokeIds.includes(id))
        );
        if (originRegion) {
          relations.push({
            id: `rel_fix_${originRegion.regionId}_${reg.regionId}`,
            fromRegionId: reg.regionId,
            toRegionId: originRegion.regionId,
            relationType: 'self_correction_candidate',
            confidence: 0.9,
            evidence: [
              `Matched correction "${ann.suggested_correction}" with ${sharedRoots.length} shared root(s)`,
            ],
          });
        }
      }
    }

    // 2. Check response written near/below an AI teaching card
    for (const card of existingTeachingCards) {
      const belowCard =
        reg.bbox.minY >= card.geometry.maxY - 12 &&
        reg.bbox.minY <= card.geometry.maxY + 140 &&
        reg.bbox.maxX >= card.geometry.minX - 60 &&
        reg.bbox.minX <= card.geometry.maxX + 120;
      if (belowCard) {
        relations.push({
          id: `rel_card_${card.cardId}_${reg.regionId}`,
          fromRegionId: reg.regionId,
          toRegionId: card.cardId,
          relationType: 'answer_to_ai_card',
          confidence: 0.84,
          evidence: [`Written directly below teaching card "${card.koreanPhrase}"`],
        });
      }
    }

    // 3. Spatial continuation vs marginal note vs explicit independence
    if (i > 0) {
      const prev = sortedByTime[i - 1];
      const verticalGap = reg.bbox.minY - prev.bbox.maxY;
      const leftDelta = Math.abs(reg.bbox.minX - prev.bbox.minX);
      const sideNote =
        Math.abs(reg.bbox.minY - prev.bbox.minY) < 42 &&
        reg.bbox.minX > prev.bbox.maxX + 30 &&
        reg.bbox.minX < prev.bbox.maxX + 260 &&
        reg.language !== prev.language;

      if (sideNote) {
        relations.push({
          id: `rel_note_${prev.regionId}_${reg.regionId}`,
          fromRegionId: reg.regionId,
          toRegionId: prev.regionId,
          relationType: 'marginal_note',
          confidence: 0.72,
          evidence: ['Mixed-language side annotation beside target region'],
        });
      } else if (verticalGap >= 10 && verticalGap <= 110 && leftDelta <= 65) {
        relations.push({
          id: `rel_cont_${prev.regionId}_${reg.regionId}`,
          fromRegionId: reg.regionId,
          toRegionId: prev.regionId,
          relationType: 'continuation_below',
          confidence: 0.68,
          evidence: [`Aligned below (${Math.round(verticalGap)}px gap, left Δ${Math.round(leftDelta)}px)`],
        });
      }
    }
  }

  return {
    boardId,
    revision,
    relations,
    updatedAt: Date.now(),
  };
}
