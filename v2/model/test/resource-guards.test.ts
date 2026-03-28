// ---------------------------------------------------------------------------
// Resource guards unit tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  validateRenderShell,
  validateDependencyManifest,
  applyRenderShellCaps,
  DEFAULT_RESOURCE_LIMITS,
  type ResourceViolation,
} from '../src/runtime/resource-guards.js';
import type { RenderShellSnapshot } from '../src/render-shell/render-shell-snapshot.js';
import type { DependencyManifest } from '../src/projections/layout/dependency-manifest.js';

// ---- Helpers ----------------------------------------------------------------

function makeShell(overrides: Partial<RenderShellSnapshot> = {}): RenderShellSnapshot {
  return {
    bodyChildCount: 10,
    sections: [
      {
        index: 0,
        pageGeometry: { width: 12240, height: 15840, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
        headerRefs: [],
        footerRefs: [],
      },
    ],
    primaryPageGeometry: { width: 12240, height: 15840, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
    availableShells: { styles: true, numbering: false, settings: false },
    ...overrides,
  };
}

function makeManifest(overrides: Partial<DependencyManifest> = {}): DependencyManifest {
  return {
    headerFooterRefs: [],
    footnoteRefs: [],
    endnoteRefs: [],
    commentRefs: [],
    imageRefs: [],
    hyperlinkRefs: [],
    ...overrides,
  };
}

// ---- validateRenderShell ----------------------------------------------------

describe('validateRenderShell', () => {
  it('returns no violations for a normal shell', () => {
    const violations = validateRenderShell(makeShell());
    expect(violations).toEqual([]);
  });

  it('returns a warning for excessive body child count', () => {
    const shell = makeShell({ bodyChildCount: 60_000 });
    const violations = validateRenderShell(shell);
    expect(violations).toContainEqual(
      expect.objectContaining({ field: 'bodyChildCount', actual: 60_000, action: 'warning' }),
    );
  });

  it('returns a warning for excessive section count', () => {
    const sections = Array.from({ length: 600 }, (_, i) => ({
      index: i,
      pageGeometry: { width: 12240, height: 15840, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
      headerRefs: [],
      footerRefs: [],
    }));
    const shell = makeShell({ sections });
    const violations = validateRenderShell(shell);
    expect(violations).toContainEqual(
      expect.objectContaining({ field: 'sectionCount', actual: 600, action: 'warning' }),
    );
  });

  it('caps a section with page width exceeding the limit', () => {
    const shell = makeShell({
      sections: [
        {
          index: 0,
          pageGeometry: {
            width: 100_000,
            height: 15840,
            margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
          headerRefs: [],
          footerRefs: [],
        },
      ],
    });
    const violations = validateRenderShell(shell);
    expect(violations).toContainEqual(
      expect.objectContaining({
        field: 'sections[0].pageGeometry.width',
        actual: 100_000,
        limit: DEFAULT_RESOURCE_LIMITS.maxPageWidthTwips,
        action: 'capped',
      }),
    );
  });

  it('caps a section with page height exceeding the limit', () => {
    const shell = makeShell({
      sections: [
        {
          index: 0,
          pageGeometry: {
            width: 12240,
            height: 100_000,
            margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
          headerRefs: [],
          footerRefs: [],
        },
      ],
    });
    const violations = validateRenderShell(shell);
    expect(violations).toContainEqual(
      expect.objectContaining({
        field: 'sections[0].pageGeometry.height',
        actual: 100_000,
        action: 'capped',
      }),
    );
  });

  it('caps primary page geometry when it exceeds limits', () => {
    const shell = makeShell({
      primaryPageGeometry: {
        width: 100_000,
        height: 100_000,
        margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
      sections: [],
    });
    const violations = validateRenderShell(shell);
    expect(violations).toContainEqual(
      expect.objectContaining({ field: 'primaryPageGeometry.width', actual: 100_000, action: 'capped' }),
    );
    expect(violations).toContainEqual(
      expect.objectContaining({ field: 'primaryPageGeometry.height', actual: 100_000, action: 'capped' }),
    );
  });

  it('respects custom limits', () => {
    const shell = makeShell({ bodyChildCount: 100 });
    const violations = validateRenderShell(shell, { maxBodyChildCount: 50 });
    expect(violations).toContainEqual(
      expect.objectContaining({ field: 'bodyChildCount', actual: 100, limit: 50, action: 'warning' }),
    );
  });

  it('returns no violations when values exactly equal limits', () => {
    const shell = makeShell({ bodyChildCount: DEFAULT_RESOURCE_LIMITS.maxBodyChildCount });
    const violations = validateRenderShell(shell);
    const bodyChildViolation = violations.find((v) => v.field === 'bodyChildCount');
    expect(bodyChildViolation).toBeUndefined();
  });

  it('detects violations across multiple sections', () => {
    const shell = makeShell({
      sections: [
        {
          index: 0,
          pageGeometry: { width: 50_000, height: 15840, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
          headerRefs: [],
          footerRefs: [],
        },
        {
          index: 1,
          pageGeometry: { width: 12240, height: 50_000, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
          headerRefs: [],
          footerRefs: [],
        },
      ],
    });
    const violations = validateRenderShell(shell);
    expect(violations).toHaveLength(2);
    expect(violations[0].field).toBe('sections[0].pageGeometry.width');
    expect(violations[1].field).toBe('sections[1].pageGeometry.height');
  });
});

// ---- validateDependencyManifest ---------------------------------------------

describe('validateDependencyManifest', () => {
  it('returns no violations for a normal manifest', () => {
    const manifest = makeManifest({
      imageRefs: [{ relationshipId: 'rId1', sourcePartUri: '/word/media/image1.png' }],
      commentRefs: [{ commentId: '1' }],
    });
    expect(validateDependencyManifest(manifest)).toEqual([]);
  });

  it('returns a warning for excessive image count', () => {
    const imageRefs = Array.from({ length: 10_001 }, (_, i) => ({
      relationshipId: `rId${i}`,
      sourcePartUri: `/word/media/image${i}.png`,
    }));
    const violations = validateDependencyManifest(makeManifest({ imageRefs }));
    expect(violations).toContainEqual(
      expect.objectContaining({ field: 'imageRefs', actual: 10_001, action: 'warning' }),
    );
  });

  it('returns a warning for excessive comment count', () => {
    const commentRefs = Array.from({ length: 5_001 }, (_, i) => ({ commentId: String(i) }));
    const violations = validateDependencyManifest(makeManifest({ commentRefs }));
    expect(violations).toContainEqual(
      expect.objectContaining({ field: 'commentRefs', actual: 5_001, action: 'warning' }),
    );
  });

  it('returns a warning for excessive note count (footnotes + endnotes combined)', () => {
    const footnoteRefs = Array.from({ length: 6_000 }, (_, i) => ({ footnoteId: String(i) }));
    const endnoteRefs = Array.from({ length: 5_000 }, (_, i) => ({ endnoteId: String(i) }));
    const violations = validateDependencyManifest(makeManifest({ footnoteRefs, endnoteRefs }));
    expect(violations).toContainEqual(
      expect.objectContaining({ field: 'noteCount', actual: 11_000, action: 'warning' }),
    );
  });

  it('respects custom limits', () => {
    const imageRefs = Array.from({ length: 5 }, (_, i) => ({
      relationshipId: `rId${i}`,
      sourcePartUri: `/word/media/image${i}.png`,
    }));
    const violations = validateDependencyManifest(makeManifest({ imageRefs }), { maxImageCount: 3 });
    expect(violations).toContainEqual(
      expect.objectContaining({ field: 'imageRefs', actual: 5, limit: 3, action: 'warning' }),
    );
  });

  it('returns no violations when counts exactly equal limits', () => {
    const imageRefs = Array.from({ length: DEFAULT_RESOURCE_LIMITS.maxImageCount }, (_, i) => ({
      relationshipId: `rId${i}`,
      sourcePartUri: `/word/media/image${i}.png`,
    }));
    const violations = validateDependencyManifest(makeManifest({ imageRefs }));
    const imageViolation = violations.find((v) => v.field === 'imageRefs');
    expect(imageViolation).toBeUndefined();
  });
});

// ---- applyRenderShellCaps ---------------------------------------------------

describe('applyRenderShellCaps', () => {
  it('returns the original shell when there are no capped violations', () => {
    const shell = makeShell();
    const violations: ResourceViolation[] = [
      { field: 'bodyChildCount', actual: 60_000, limit: 50_000, action: 'warning' },
    ];
    const result = applyRenderShellCaps(shell, violations);
    expect(result).toBe(shell); // Same reference — no copy
  });

  it('clamps section page width to the limit', () => {
    const shell = makeShell({
      sections: [
        {
          index: 0,
          pageGeometry: {
            width: 100_000,
            height: 15840,
            margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
          headerRefs: [],
          footerRefs: [],
        },
      ],
    });
    const violations = validateRenderShell(shell);
    const result = applyRenderShellCaps(shell, violations);
    expect(result.sections[0].pageGeometry.width).toBe(DEFAULT_RESOURCE_LIMITS.maxPageWidthTwips);
    expect(result.sections[0].pageGeometry.height).toBe(15840); // Untouched
  });

  it('clamps primary page geometry', () => {
    const shell = makeShell({
      primaryPageGeometry: {
        width: 100_000,
        height: 100_000,
        margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
      sections: [],
    });
    const violations = validateRenderShell(shell);
    const result = applyRenderShellCaps(shell, violations);
    expect(result.primaryPageGeometry!.width).toBe(DEFAULT_RESOURCE_LIMITS.maxPageWidthTwips);
    expect(result.primaryPageGeometry!.height).toBe(DEFAULT_RESOURCE_LIMITS.maxPageHeightTwips);
  });

  it('does not mutate the original shell', () => {
    const shell = makeShell({
      sections: [
        {
          index: 0,
          pageGeometry: {
            width: 100_000,
            height: 15840,
            margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
          headerRefs: [],
          footerRefs: [],
        },
      ],
    });
    const violations = validateRenderShell(shell);
    applyRenderShellCaps(shell, violations);
    expect(shell.sections[0].pageGeometry.width).toBe(100_000);
  });

  it('handles multiple sections with mixed violations', () => {
    const shell = makeShell({
      sections: [
        {
          index: 0,
          pageGeometry: { width: 50_000, height: 15840, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
          headerRefs: [],
          footerRefs: [],
        },
        {
          index: 1,
          pageGeometry: { width: 12240, height: 50_000, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
          headerRefs: [],
          footerRefs: [],
        },
        {
          index: 2,
          pageGeometry: { width: 12240, height: 15840, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
          headerRefs: [],
          footerRefs: [],
        },
      ],
    });
    const violations = validateRenderShell(shell);
    const result = applyRenderShellCaps(shell, violations);

    expect(result.sections[0].pageGeometry.width).toBe(DEFAULT_RESOURCE_LIMITS.maxPageWidthTwips);
    expect(result.sections[1].pageGeometry.height).toBe(DEFAULT_RESOURCE_LIMITS.maxPageHeightTwips);
    // Section 2 should be unchanged
    expect(result.sections[2].pageGeometry.width).toBe(12240);
    expect(result.sections[2].pageGeometry.height).toBe(15840);
  });
});
