import { describe, it, expect } from 'vitest';
import type { TrackedChangeAddress } from '@superdoc/document-api';
import { DocumentApiAdapterError } from '../errors.js';
import {
  isCommentAnchorKey,
  isTrackedChangeAnchorKey,
  makeCommentAnchorKey,
  makeTrackedChangeAnchorKey,
  parseTrackedChangeAnchorKey,
  toTrackedChangeAddress,
  toTrackedChangeRuntimeRef,
} from './tracked-change-runtime-ref.js';

describe('toTrackedChangeRuntimeRef', () => {
  it('resolves an address without story to a body runtime ref', () => {
    const ref = toTrackedChangeRuntimeRef({ kind: 'entity', entityType: 'trackedChange', entityId: 'rev-123' });
    expect(ref).toEqual({ storyKey: 'body', rawId: 'rev-123' });
  });

  it('resolves a footnote address', () => {
    const address: TrackedChangeAddress = {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'rev-123',
      story: { kind: 'story', storyType: 'footnote', noteId: '5' },
    };
    expect(toTrackedChangeRuntimeRef(address)).toEqual({ storyKey: 'fn:5', rawId: 'rev-123' });
  });

  it('resolves an endnote address', () => {
    const ref = toTrackedChangeRuntimeRef({
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'r1',
      story: { kind: 'story', storyType: 'endnote', noteId: '2' },
    });
    expect(ref).toEqual({ storyKey: 'en:2', rawId: 'r1' });
  });

  it('resolves a header/footer part address', () => {
    const ref = toTrackedChangeRuntimeRef({
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'r7',
      story: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId4' },
    });
    expect(ref).toEqual({ storyKey: 'hf:part:rId4', rawId: 'r7' });
  });

  it('resolves a header/footer slot address with default semantics', () => {
    const ref = toTrackedChangeRuntimeRef({
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'rev-9',
      story: {
        kind: 'story',
        storyType: 'headerFooterSlot',
        section: { kind: 'section', sectionId: 'sec2' },
        headerFooterKind: 'header',
        variant: 'default',
      },
    });
    expect(ref).toEqual({
      storyKey: 'hf:slot:sec2:header:default:effective:materializeIfInherited',
      rawId: 'rev-9',
    });
  });

  it('throws INVALID_INPUT for missing entityId', () => {
    expect(() =>
      toTrackedChangeRuntimeRef({ kind: 'entity', entityType: 'trackedChange', entityId: '' } as TrackedChangeAddress),
    ).toThrow(DocumentApiAdapterError);
  });

  it('throws INVALID_INPUT for malformed story locator', () => {
    expect(() =>
      toTrackedChangeRuntimeRef({
        kind: 'entity',
        entityType: 'trackedChange',
        entityId: 'x',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        story: { kind: 'story', storyType: 'foo' } as any,
      }),
    ).toThrow(DocumentApiAdapterError);
  });
});

describe('toTrackedChangeAddress', () => {
  it('round-trips a body runtime ref (omits story field)', () => {
    const address = toTrackedChangeAddress({ storyKey: 'body', rawId: 'rev-42' });
    expect(address).toEqual({ kind: 'entity', entityType: 'trackedChange', entityId: 'rev-42' });
    expect('story' in address).toBe(false);
  });

  it('round-trips a footnote runtime ref', () => {
    const address = toTrackedChangeAddress({ storyKey: 'fn:5', rawId: 'rev-123' });
    expect(address).toEqual({
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'rev-123',
      story: { kind: 'story', storyType: 'footnote', noteId: '5' },
    });
  });

  it('round-trips a header/footer slot runtime ref', () => {
    const ref = { storyKey: 'hf:slot:sec2:footer:first:effective:materializeIfInherited', rawId: 'rev-0' };
    const address = toTrackedChangeAddress(ref);
    expect(address.story).toEqual({
      kind: 'story',
      storyType: 'headerFooterSlot',
      section: { kind: 'section', sectionId: 'sec2' },
      headerFooterKind: 'footer',
      variant: 'first',
      resolution: 'effective',
      onWrite: 'materializeIfInherited',
    });
  });

  it('throws INVALID_INPUT on unparseable storyKey', () => {
    expect(() => toTrackedChangeAddress({ storyKey: 'not-a-key', rawId: 'r1' })).toThrow(DocumentApiAdapterError);
  });
});

describe('round-trip address <-> runtime ref', () => {
  const fixtures: TrackedChangeAddress[] = [
    { kind: 'entity', entityType: 'trackedChange', entityId: 'a' },
    {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'b',
      story: { kind: 'story', storyType: 'body' },
    },
    {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'c',
      story: { kind: 'story', storyType: 'footnote', noteId: '99' },
    },
    {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'd',
      story: { kind: 'story', storyType: 'endnote', noteId: '12' },
    },
    {
      kind: 'entity',
      entityType: 'trackedChange',
      entityId: 'e',
      story: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId10' },
    },
  ];

  it.each(fixtures)('stays stable for %j', (address) => {
    const ref = toTrackedChangeRuntimeRef(address);
    const roundTrip = toTrackedChangeAddress(ref);
    // Body with explicit `story: body` normalizes to no story — that is expected
    // and backward-compatible. Compare on entityId+story-identity rather than
    // strict equality.
    expect(roundTrip.entityId).toBe(address.entityId);
    if (address.story && address.story.storyType !== 'body') {
      expect(roundTrip.story).toEqual(address.story);
    } else {
      expect(roundTrip.story).toBeUndefined();
    }
  });
});

describe('anchor key helpers', () => {
  it('makeTrackedChangeAnchorKey formats tc::<storyKey>::<rawId>', () => {
    expect(makeTrackedChangeAnchorKey({ storyKey: 'body', rawId: 'rev-1' })).toBe('tc::body::rev-1');
    expect(makeTrackedChangeAnchorKey({ storyKey: 'hf:part:rId4', rawId: 'r7' })).toBe('tc::hf:part:rId4::r7');
    expect(makeTrackedChangeAnchorKey({ storyKey: 'fn:5', rawId: 'rev-123' })).toBe('tc::fn:5::rev-123');
  });

  it('makeCommentAnchorKey formats comment::<id>', () => {
    expect(makeCommentAnchorKey('c-1')).toBe('comment::c-1');
  });

  it('isTrackedChangeAnchorKey classifies keys', () => {
    expect(isTrackedChangeAnchorKey('tc::body::r1')).toBe(true);
    expect(isTrackedChangeAnchorKey('comment::c-1')).toBe(false);
    expect(isTrackedChangeAnchorKey('r1')).toBe(false);
  });

  it('isCommentAnchorKey classifies keys', () => {
    expect(isCommentAnchorKey('comment::c-1')).toBe(true);
    expect(isCommentAnchorKey('tc::body::r1')).toBe(false);
  });

  it('parseTrackedChangeAnchorKey round-trips body and non-body', () => {
    expect(parseTrackedChangeAnchorKey('tc::body::rev-1')).toEqual({ storyKey: 'body', rawId: 'rev-1' });
    expect(parseTrackedChangeAnchorKey('tc::hf:part:rId4::r7')).toEqual({
      storyKey: 'hf:part:rId4',
      rawId: 'r7',
    });
    expect(parseTrackedChangeAnchorKey('tc::fn:12::rev-abc')).toEqual({ storyKey: 'fn:12', rawId: 'rev-abc' });
  });

  it('parseTrackedChangeAnchorKey rejects malformed keys', () => {
    expect(parseTrackedChangeAnchorKey('not-an-anchor')).toBeNull();
    expect(parseTrackedChangeAnchorKey('tc::')).toBeNull();
    expect(parseTrackedChangeAnchorKey('comment::c1')).toBeNull();
  });
});
