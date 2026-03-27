// ---------------------------------------------------------------------------
// headersFootersView — typed view over header/footer parts
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlElementNode } from "../types/xml.js";
import type { PartUri, RelationshipRecord } from "../types/package.js";
import { getXmlPart, getPartRoot } from "./view-base.js";
import {
  findRelationshipsByType,
  resolveRelationshipTarget,
  REL_TYPES,
} from "../opc/relationships.js";

export type HeaderFooterDescriptor = {
  relationshipId: string;
  partUri: PartUri;
  type: "header" | "footer";
  element(): XmlElementNode | undefined;
};

export type HeadersFootersView = {
  /** List all header and footer parts reachable from the main document. */
  list(): HeaderFooterDescriptor[];
  /** Get a specific header/footer by its relationship ID. */
  byRelationshipId(rId: string): HeaderFooterDescriptor | undefined;
};

export function createHeadersFootersView(
  session: PackageSession,
  mainDocUri: PartUri,
): HeadersFootersView | undefined {
  const maybePartRels = session.relationships.partRelationships.get(mainDocUri);
  if (!maybePartRels) return undefined;
  const partRels = maybePartRels;

  let cached: HeaderFooterDescriptor[] | undefined;

  function list(): HeaderFooterDescriptor[] {
    if (cached) return cached;

    const headers = findRelationshipsByType(partRels, REL_TYPES.header);
    const footers = findRelationshipsByType(partRels, REL_TYPES.footer);

    cached = [
      ...headers.map((r) => buildDescriptor(r, "header")),
      ...footers.map((r) => buildDescriptor(r, "footer")),
    ];

    return cached;
  }

  function buildDescriptor(
    rel: RelationshipRecord,
    type: "header" | "footer",
  ): HeaderFooterDescriptor {
    const descriptorPartUri = resolveRelationshipTarget(mainDocUri, rel.target);
    return {
      relationshipId: rel.id,
      partUri: descriptorPartUri,
      type,
      element(): XmlElementNode | undefined {
        const hfPart = getXmlPart(session, descriptorPartUri);
        if (!hfPart) return undefined;
        return getPartRoot(hfPart, session);
      },
    };
  }

  return {
    list,
    byRelationshipId(rId: string): HeaderFooterDescriptor | undefined {
      return list().find((d) => d.relationshipId === rId);
    },
  };
}
