// ---------------------------------------------------------------------------
// documentView — typed view over /word/document.xml
//
// Uses the lexical index for metadata queries (count, names) and hydrates
// individual boundary regions on demand — not the entire document tree.
// ---------------------------------------------------------------------------

import type { PackageSession } from '../types/session.js';
import type { XmlElementNode } from '../types/xml.js';
import type { PartUri } from '../types/package.js';
import { getXmlPart, getPartRoot, getBoundaryRecords, hydratePartRegion, markPartDirty } from './view-base.js';
import { findChildElement, getAttr } from './tree-helpers.js';

export type BodyChildDescriptor = {
  index: number;
  kind: string;
  localName: string;
  element: XmlElementNode;
};

export type SectionDescriptor = {
  index: number;
  /** The w:sectPr element (either inside last w:pPr or standalone). */
  sectPr: XmlElementNode;
  /** Related header/footer relationship IDs. */
  headerRefs: string[];
  footerRefs: string[];
};

export type DocumentView = {
  /** The main document part URI. */
  partUri: PartUri;
  /** Enumerate w:body structural children. */
  bodyChildren(): BodyChildDescriptor[];
  /** Get a specific body child by index. */
  bodyChild(index: number): BodyChildDescriptor | undefined;
  /** Get the stable xpath-like source path for a specific body child. */
  bodyChildPath(index: number): string | undefined;
  /** Count of body children (uses index only — no hydration). */
  bodyChildCount(): number;
  /** Enumerate section properties found in the document. */
  sections(): SectionDescriptor[];
  /** Get the raw root element (triggers full hydration). */
  rootElement(): XmlElementNode | undefined;
  /** Mark the document part as dirty (call after mutating nodes). */
  markDirty(): void;
};

/** Create a documentView for the session's main document part. */
export function createDocumentView(session: PackageSession, mainDocUri: PartUri): DocumentView | undefined {
  const maybePart = getXmlPart(session, mainDocUri);
  if (!maybePart) return undefined;
  const part = maybePart;

  // Lazy caches
  let cachedBodyChildren: BodyChildDescriptor[] | undefined;
  let cachedBodyChildPaths: string[] | undefined;

  /**
   * When the part is in "mutated" state the lexical index is stale.
   * Fall through to the live tree to enumerate body children.
   */
  function getBodyChildrenFromTree(): XmlElementNode[] {
    const root = getPartRoot(part, session);
    if (!root) return [];
    const body = root.children.find((c): c is XmlElementNode => c.kind === 'element' && c.localName === 'body');
    if (!body) return [];
    return body.children.filter((c): c is XmlElementNode => c.kind === 'element');
  }

  function isTreeAuthoritative(): boolean {
    return part.treeState.kind === 'mutated' || part.treeState.kind === 'fully-hydrated';
  }

  function bodyChildCount(): number {
    if (isTreeAuthoritative()) {
      return getBodyChildrenFromTree().length;
    }
    return getBoundaryRecords(part, session).length;
  }

  function bodyChild(index: number): BodyChildDescriptor | undefined {
    // Mutated or fully-hydrated: use the live tree directly
    if (isTreeAuthoritative()) {
      const elements = getBodyChildrenFromTree();
      if (index < 0 || index >= elements.length) return undefined;
      const el = elements[index];
      return {
        index,
        kind: el.prefix ? `${el.prefix}:${el.localName}` : el.localName,
        localName: el.localName,
        element: el,
      };
    }

    // Index-based path: hydrate individual regions on demand
    const records = getBoundaryRecords(part, session);
    if (index < 0 || index >= records.length) return undefined;

    const record = records[index];
    const regionId = `region:${record.id}`;
    const element = hydratePartRegion(part, session, regionId);
    if (!element) return undefined;

    return {
      index,
      kind: record.prefix ? `${record.prefix}:${record.localName}` : record.localName!,
      localName: record.localName!,
      element,
    };
  }

  function bodyChildren(): BodyChildDescriptor[] {
    // When the tree is authoritative (mutated or fully-hydrated), the cached
    // array may be stale because mutations bypass markDirty(). Always rebuild
    // from the live tree in that case.
    if (cachedBodyChildren && !isTreeAuthoritative()) return cachedBodyChildren;

    const count = bodyChildCount();
    const result: BodyChildDescriptor[] = [];

    for (let i = 0; i < count; i++) {
      const desc = bodyChild(i);
      if (desc) result.push(desc);
    }

    cachedBodyChildren = result;
    return cachedBodyChildren;
  }

  function bodyChildPath(index: number): string | undefined {
    const paths = getBodyChildPaths();
    if (index < 0 || index >= paths.length) {
      return undefined;
    }
    return paths[index];
  }

  function getBodyChildPaths(): string[] {
    if (cachedBodyChildPaths && !isTreeAuthoritative()) {
      return cachedBodyChildPaths;
    }

    const paths = isTreeAuthoritative()
      ? buildPathsFromElements(getBodyChildrenFromTree())
      : buildPathsFromBoundaryRecords();

    cachedBodyChildPaths = paths;
    return paths;
  }

  function buildPathsFromBoundaryRecords(): string[] {
    const records = getBoundaryRecords(part, session);
    const siblingCountByQualifiedName = new Map<string, number>();

    return records.map((record) => {
      const qname = record.prefix ? `${record.prefix}:${record.localName}` : (record.localName ?? 'node');
      const siblingIndex = (siblingCountByQualifiedName.get(qname) ?? 0) + 1;
      siblingCountByQualifiedName.set(qname, siblingIndex);
      return `w:body/${qname}[${siblingIndex}]`;
    });
  }

  function buildPathsFromElements(elements: XmlElementNode[]): string[] {
    const siblingCountByQualifiedName = new Map<string, number>();

    return elements.map((element) => {
      const qname = element.prefix ? `${element.prefix}:${element.localName}` : element.localName;
      const siblingIndex = (siblingCountByQualifiedName.get(qname) ?? 0) + 1;
      siblingCountByQualifiedName.set(qname, siblingIndex);
      return `w:body/${qname}[${siblingIndex}]`;
    });
  }

  return {
    partUri: mainDocUri,

    bodyChildren,
    bodyChild,
    bodyChildPath,
    bodyChildCount,

    sections(): SectionDescriptor[] {
      const children = bodyChildren();
      const sections: SectionDescriptor[] = [];

      for (let i = 0; i < children.length; i++) {
        const el = children[i].element;

        // Section properties can be inside the last w:pPr of a w:p, or standalone w:sectPr
        if (el.localName === 'sectPr' && el.prefix === 'w') {
          sections.push(buildSectionDescriptor(i, el));
        } else if (el.localName === 'p' && el.prefix === 'w') {
          const pPr = findChildElement(el, 'pPr', 'w');
          if (pPr) {
            const sectPr = findChildElement(pPr, 'sectPr', 'w');
            if (sectPr) {
              sections.push(buildSectionDescriptor(i, sectPr));
            }
          }
        }
      }

      return sections;
    },

    rootElement(): XmlElementNode | undefined {
      return getPartRoot(part, session);
    },

    markDirty(): void {
      cachedBodyChildren = undefined;
      cachedBodyChildPaths = undefined;
      markPartDirty(part, session);
    },
  };
}

function buildSectionDescriptor(index: number, sectPr: XmlElementNode): SectionDescriptor {
  const headerRefs: string[] = [];
  const footerRefs: string[] = [];

  for (const child of sectPr.children) {
    if (child.kind !== 'element') continue;
    if (child.localName === 'headerReference' && child.prefix === 'w') {
      const rId = getAttr(child, 'id', 'r');
      if (rId) headerRefs.push(rId);
    }
    if (child.localName === 'footerReference' && child.prefix === 'w') {
      const rId = getAttr(child, 'id', 'r');
      if (rId) footerRefs.push(rId);
    }
  }

  return { index, sectPr, headerRefs, footerRefs };
}
