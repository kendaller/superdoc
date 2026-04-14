export type CharacterBox = {
  readonly fromOffset: number;
  readonly toOffset: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
};

export type ResolvedCharacterOffset = {
  readonly offset: number;
  readonly affinity: 'backward' | 'forward';
};

type LineCandidate = {
  readonly box: CharacterBox;
  readonly verticalDistance: number;
  readonly horizontalDistance: number;
};

/**
 * Resolve the nearest caret offset from a set of measured character boxes.
 *
 * This is a geometry fallback for cases where browser caret APIs cannot
 * provide a reliable DOM point for the rendered paragraph.
 */
export function resolveOffsetFromCharacterBoxes(
  boxes: readonly CharacterBox[],
  clientX: number,
  clientY: number,
): ResolvedCharacterOffset | null {
  if (boxes.length === 0) {
    return null;
  }

  const nearestBox = chooseNearestBox(boxes, clientX, clientY);
  if (!nearestBox) {
    return null;
  }

  const boxMidpoint = nearestBox.left + (nearestBox.right - nearestBox.left) / 2;
  return clientX <= boxMidpoint
    ? { offset: nearestBox.fromOffset, affinity: 'backward' }
    : { offset: nearestBox.toOffset, affinity: 'forward' };
}

function chooseNearestBox(boxes: readonly CharacterBox[], clientX: number, clientY: number): CharacterBox | null {
  const candidates: LineCandidate[] = boxes.map((box) => ({
    box,
    verticalDistance: axisDistance(clientY, box.top, box.bottom),
    horizontalDistance: axisDistance(clientX, box.left, box.right),
  }));

  candidates.sort((left, right) => {
    if (left.verticalDistance !== right.verticalDistance) {
      return left.verticalDistance - right.verticalDistance;
    }

    if (left.horizontalDistance !== right.horizontalDistance) {
      return left.horizontalDistance - right.horizontalDistance;
    }

    if (left.box.top !== right.box.top) {
      return left.box.top - right.box.top;
    }

    return left.box.left - right.box.left;
  });

  return candidates[0]?.box ?? null;
}

function axisDistance(value: number, start: number, end: number): number {
  if (value < start) {
    return start - value;
  }

  if (value > end) {
    return value - end;
  }

  return 0;
}
