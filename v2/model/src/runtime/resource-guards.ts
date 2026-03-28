// ---------------------------------------------------------------------------
// Resource guards — validate render shells and dependency manifests against
// configurable limits to prevent hostile or malformed documents from causing
// runaway allocation.
//
// All functions are pure: they receive data, return violations, and never
// throw or mutate their inputs. The caller decides what to do (cap, warn,
// reject).
// ---------------------------------------------------------------------------

import type { RenderShellSnapshot } from '../render-shell/render-shell-snapshot.js';
import type { DependencyManifest } from '../projections/layout/dependency-manifest.js';

// ---- Types ------------------------------------------------------------------

export type ResourceLimits = {
  /** Max page width in twips. Default: 43200 (30 inches). */
  maxPageWidthTwips: number;
  /** Max page height in twips. Default: 43200 (30 inches). */
  maxPageHeightTwips: number;
  /** Max image references per document. Default: 10_000. */
  maxImageCount: number;
  /** Max comment references per document. Default: 5_000. */
  maxCommentCount: number;
  /** Max sections per document. Default: 500. */
  maxSectionCount: number;
  /** Max body children per document. Default: 50_000. */
  maxBodyChildCount: number;
  /** Max footnote + endnote references. Default: 10_000. */
  maxNoteCount: number;
};

export type ResourceViolation = {
  /** The field that exceeded its limit. */
  field: string;
  /** The actual value found. */
  actual: number;
  /** The configured limit. */
  limit: number;
  /** 'capped' = the host should clamp the value; 'warning' = log only. */
  action: 'capped' | 'warning';
};

// ---- Defaults ---------------------------------------------------------------

export const DEFAULT_RESOURCE_LIMITS: Readonly<ResourceLimits> = {
  maxPageWidthTwips: 43_200, // 30 inches
  maxPageHeightTwips: 43_200, // 30 inches
  maxImageCount: 10_000,
  maxCommentCount: 5_000,
  maxSectionCount: 500,
  maxBodyChildCount: 50_000,
  maxNoteCount: 10_000,
};

// ---- Validation: Render Shell -----------------------------------------------

/**
 * Validate a render-shell snapshot against resource limits.
 *
 * Returns an array of violations. An empty array means the shell is within
 * all limits.
 */
export function validateRenderShell(
  shell: RenderShellSnapshot,
  limits: Partial<ResourceLimits> = {},
): ResourceViolation[] {
  const resolved = { ...DEFAULT_RESOURCE_LIMITS, ...limits };
  const violations: ResourceViolation[] = [];

  // Body child count
  if (shell.bodyChildCount > resolved.maxBodyChildCount) {
    violations.push({
      field: 'bodyChildCount',
      actual: shell.bodyChildCount,
      limit: resolved.maxBodyChildCount,
      action: 'warning',
    });
  }

  // Section count
  if (shell.sections.length > resolved.maxSectionCount) {
    violations.push({
      field: 'sectionCount',
      actual: shell.sections.length,
      limit: resolved.maxSectionCount,
      action: 'warning',
    });
  }

  // Per-section page geometry
  for (const section of shell.sections) {
    if (section.pageGeometry.width > resolved.maxPageWidthTwips) {
      violations.push({
        field: `sections[${section.index}].pageGeometry.width`,
        actual: section.pageGeometry.width,
        limit: resolved.maxPageWidthTwips,
        action: 'capped',
      });
    }
    if (section.pageGeometry.height > resolved.maxPageHeightTwips) {
      violations.push({
        field: `sections[${section.index}].pageGeometry.height`,
        actual: section.pageGeometry.height,
        limit: resolved.maxPageHeightTwips,
        action: 'capped',
      });
    }
  }

  // Primary page geometry
  if (shell.primaryPageGeometry) {
    if (shell.primaryPageGeometry.width > resolved.maxPageWidthTwips) {
      violations.push({
        field: 'primaryPageGeometry.width',
        actual: shell.primaryPageGeometry.width,
        limit: resolved.maxPageWidthTwips,
        action: 'capped',
      });
    }
    if (shell.primaryPageGeometry.height > resolved.maxPageHeightTwips) {
      violations.push({
        field: 'primaryPageGeometry.height',
        actual: shell.primaryPageGeometry.height,
        limit: resolved.maxPageHeightTwips,
        action: 'capped',
      });
    }
  }

  return violations;
}

// ---- Validation: Dependency Manifest ----------------------------------------

/**
 * Validate a dependency manifest against resource limits.
 *
 * Returns an array of violations. An empty array means the manifest is within
 * all limits.
 */
export function validateDependencyManifest(
  manifest: DependencyManifest,
  limits: Partial<ResourceLimits> = {},
): ResourceViolation[] {
  const resolved = { ...DEFAULT_RESOURCE_LIMITS, ...limits };
  const violations: ResourceViolation[] = [];

  if (manifest.imageRefs.length > resolved.maxImageCount) {
    violations.push({
      field: 'imageRefs',
      actual: manifest.imageRefs.length,
      limit: resolved.maxImageCount,
      action: 'warning',
    });
  }

  if (manifest.commentRefs.length > resolved.maxCommentCount) {
    violations.push({
      field: 'commentRefs',
      actual: manifest.commentRefs.length,
      limit: resolved.maxCommentCount,
      action: 'warning',
    });
  }

  const noteCount = manifest.footnoteRefs.length + manifest.endnoteRefs.length;
  if (noteCount > resolved.maxNoteCount) {
    violations.push({
      field: 'noteCount',
      actual: noteCount,
      limit: resolved.maxNoteCount,
      action: 'warning',
    });
  }

  return violations;
}

// ---- Capping helper ---------------------------------------------------------

/**
 * Apply 'capped' violations to a render-shell snapshot, returning a new
 * snapshot with page dimensions clamped to their limits.
 *
 * Does NOT mutate the input.
 */
export function applyRenderShellCaps(shell: RenderShellSnapshot, violations: ResourceViolation[]): RenderShellSnapshot {
  const cappedViolations = violations.filter((v) => v.action === 'capped');
  if (cappedViolations.length === 0) return shell;

  // Build a lookup: field → limit
  const caps = new Map(cappedViolations.map((v) => [v.field, v.limit]));

  const clampedSections = shell.sections.map((section) => {
    const wCap = caps.get(`sections[${section.index}].pageGeometry.width`);
    const hCap = caps.get(`sections[${section.index}].pageGeometry.height`);
    if (wCap == null && hCap == null) return section;

    return {
      ...section,
      pageGeometry: {
        ...section.pageGeometry,
        width: wCap != null ? Math.min(section.pageGeometry.width, wCap) : section.pageGeometry.width,
        height: hCap != null ? Math.min(section.pageGeometry.height, hCap) : section.pageGeometry.height,
      },
    };
  });

  let clampedPrimary = shell.primaryPageGeometry;
  const primaryWCap = caps.get('primaryPageGeometry.width');
  const primaryHCap = caps.get('primaryPageGeometry.height');
  if (clampedPrimary && (primaryWCap != null || primaryHCap != null)) {
    clampedPrimary = {
      ...clampedPrimary,
      width: primaryWCap != null ? Math.min(clampedPrimary.width, primaryWCap) : clampedPrimary.width,
      height: primaryHCap != null ? Math.min(clampedPrimary.height, primaryHCap) : clampedPrimary.height,
    };
  }

  return {
    ...shell,
    sections: clampedSections,
    primaryPageGeometry: clampedPrimary,
  };
}
