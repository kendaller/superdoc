import { describe, expect, it } from 'vitest';
import { resolveOffsetFromCharacterBoxes, type CharacterBox } from './V2GeometryHitTesting.js';

describe('resolveOffsetFromCharacterBoxes', () => {
  it('returns null when no character boxes are available', () => {
    expect(resolveOffsetFromCharacterBoxes([], 10, 10)).toBeNull();
  });

  it('resolves to the nearest character boundary within a line', () => {
    const boxes: CharacterBox[] = [
      { fromOffset: 0, toOffset: 1, left: 10, right: 20, top: 10, bottom: 20 },
      { fromOffset: 1, toOffset: 2, left: 20, right: 30, top: 10, bottom: 20 },
      { fromOffset: 2, toOffset: 3, left: 30, right: 40, top: 10, bottom: 20 },
    ];

    expect(resolveOffsetFromCharacterBoxes(boxes, 12, 15)).toEqual({
      offset: 0,
      affinity: 'backward',
    });
    expect(resolveOffsetFromCharacterBoxes(boxes, 28, 15)).toEqual({
      offset: 2,
      affinity: 'forward',
    });
  });

  it('prefers the closest visual line before horizontal proximity', () => {
    const boxes: CharacterBox[] = [
      { fromOffset: 0, toOffset: 1, left: 10, right: 20, top: 10, bottom: 20 },
      { fromOffset: 1, toOffset: 2, left: 20, right: 30, top: 10, bottom: 20 },
      { fromOffset: 2, toOffset: 3, left: 10, right: 20, top: 30, bottom: 40 },
      { fromOffset: 3, toOffset: 4, left: 20, right: 30, top: 30, bottom: 40 },
    ];

    expect(resolveOffsetFromCharacterBoxes(boxes, 12, 34)).toEqual({
      offset: 2,
      affinity: 'backward',
    });
    expect(resolveOffsetFromCharacterBoxes(boxes, 27, 34)).toEqual({
      offset: 4,
      affinity: 'forward',
    });
  });
});
