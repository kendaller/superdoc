// ---------------------------------------------------------------------------
// contentTypesView — typed access to [Content_Types].xml
// relationshipsView — typed access to .rels relationships
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { PartUri, RelationshipRecord } from "../types/package.js";
import { resolveContentType } from "../opc/content-types.js";

export type ContentTypesView = {
  /** Get the content type for a part URI. */
  getContentType(uri: PartUri): string | undefined;
  /** List all extension defaults. */
  defaults(): [extension: string, contentType: string][];
  /** List all explicit overrides. */
  overrides(): [uri: PartUri, contentType: string][];
};

export type RelationshipsView = {
  /** Get package-level relationships. */
  packageRelationships(): Map<string, RelationshipRecord>;
  /** Get part-level relationships for a given part URI. */
  partRelationships(uri: PartUri): Map<string, RelationshipRecord> | undefined;
  /** Find relationships of a specific type for a part. */
  findByType(uri: PartUri, type: string): RelationshipRecord[];
};

export function createContentTypesView(
  session: PackageSession,
): ContentTypesView {
  const ct = session.contentTypes;

  return {
    getContentType(uri: PartUri): string | undefined {
      return resolveContentType(ct, uri);
    },

    defaults(): [string, string][] {
      return [...ct.defaults.entries()];
    },

    overrides(): [PartUri, string][] {
      return [...ct.overrides.entries()];
    },
  };
}

export function createRelationshipsView(
  session: PackageSession,
): RelationshipsView {
  const rels = session.relationships;

  return {
    packageRelationships(): Map<string, RelationshipRecord> {
      return rels.packageRelationships;
    },

    partRelationships(uri: PartUri): Map<string, RelationshipRecord> | undefined {
      return rels.partRelationships.get(uri);
    },

    findByType(uri: PartUri, type: string): RelationshipRecord[] {
      const partRels = rels.partRelationships.get(uri);
      if (!partRels) return [];
      const result: RelationshipRecord[] = [];
      for (const rel of partRels.values()) {
        if (rel.type === type) result.push(rel);
      }
      return result;
    },
  };
}
