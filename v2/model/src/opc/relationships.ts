// ---------------------------------------------------------------------------
// OPC relationship parser
// ---------------------------------------------------------------------------

import type {
  PartUri,
  RelationshipIndex,
  RelationshipRecord,
} from "../types/package.js";
import { parseMiniXml } from "./xml-utils.js";

// Well-known relationship types
export const REL_TYPES = {
  officeDocument:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  styles:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  numbering:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
  settings:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings",
  fontTable:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable",
  theme:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  header:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
  footer:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
  comments:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  footnotes:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes",
  endnotes:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes",
  image:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  hyperlink:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  coreProperties:
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  extendedProperties:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
} as const;

/** Parse a .rels XML string into a map of relationship records. */
export function parseRelationships(
  xml: string,
): Map<string, RelationshipRecord> {
  const root = parseMiniXml(xml);
  const records = new Map<string, RelationshipRecord>();

  for (const child of root.children) {
    if (child.localName === "Relationship") {
      const id = child.attributes["Id"];
      const type = child.attributes["Type"];
      const target = child.attributes["Target"];
      const targetMode = child.attributes["TargetMode"] as
        | "Internal"
        | "External"
        | undefined;

      if (id && type && target) {
        records.set(id, { id, type, target, targetMode });
      }
    }
  }

  return records;
}

/** Create an empty RelationshipIndex. */
export function createRelationshipIndex(): RelationshipIndex {
  return {
    packageRelationships: new Map(),
    partRelationships: new Map(),
  };
}

/**
 * Resolve a relationship target to an absolute part URI.
 *
 * Targets in .rels files are relative to the source part's directory.
 * E.g., in `/word/_rels/document.xml.rels`, target "styles.xml"
 * resolves to "/word/styles.xml".
 */
export function resolveRelationshipTarget(
  sourcePartUri: PartUri,
  target: string,
): PartUri {
  // External targets stay as-is
  if (target.startsWith("http://") || target.startsWith("https://")) {
    return target;
  }

  // Absolute targets
  if (target.startsWith("/")) return target;

  // Relative target — resolve against source part's directory
  const sourceDir = sourcePartUri.slice(
    0,
    sourcePartUri.lastIndexOf("/") + 1,
  );
  const resolved = sourceDir + target;

  // Normalize ".." segments
  return normalizePath(resolved);
}

function normalizePath(path: string): string {
  const parts = path.split("/");
  const normalized: string[] = [];

  for (const part of parts) {
    if (part === "..") {
      normalized.pop();
    } else if (part !== ".") {
      normalized.push(part);
    }
  }

  return normalized.join("/");
}

// ---- Serialization --------------------------------------------------------

const RELS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";

/** Serialize a map of relationship records to valid .rels XML. */
export function serializeRelationships(
  records: Map<string, RelationshipRecord>,
): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<Relationships xmlns="${RELS_NAMESPACE}">`,
  ];

  for (const rel of records.values()) {
    const attrs = [
      `Id="${escapeAttrValue(rel.id)}"`,
      `Type="${escapeAttrValue(rel.type)}"`,
      `Target="${escapeAttrValue(rel.target)}"`,
    ];
    if (rel.targetMode) {
      attrs.push(`TargetMode="${escapeAttrValue(rel.targetMode)}"`);
    }
    lines.push(`  <Relationship ${attrs.join(" ")}/>`);
  }

  lines.push("</Relationships>");
  return lines.join("\n");
}

function escapeAttrValue(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- Query helpers --------------------------------------------------------

/** Find relationships of a given type from a relationship map. */
export function findRelationshipsByType(
  rels: Map<string, RelationshipRecord>,
  type: string,
): RelationshipRecord[] {
  const result: RelationshipRecord[] = [];
  for (const rel of rels.values()) {
    if (rel.type === type) result.push(rel);
  }
  return result;
}
