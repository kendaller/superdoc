// ---------------------------------------------------------------------------
// [Content_Types].xml parser
// ---------------------------------------------------------------------------

import type { ContentTypesModel, PartUri } from "../types/package.js";
import { parseMiniXml } from "./xml-utils.js";

/**
 * Parse [Content_Types].xml into a ContentTypesModel.
 *
 * This file maps file extensions → content types (defaults)
 * and specific part URIs → content types (overrides).
 */
export function parseContentTypes(xml: string): ContentTypesModel {
  const root = parseMiniXml(xml);
  const defaults = new Map<string, string>();
  const overrides = new Map<PartUri, string>();

  for (const child of root.children) {
    if (child.localName === "Default") {
      const ext = child.attributes["Extension"];
      const ct = child.attributes["ContentType"];
      if (ext && ct) defaults.set(ext.toLowerCase(), ct);
    } else if (child.localName === "Override") {
      const partName = child.attributes["PartName"];
      const ct = child.attributes["ContentType"];
      if (partName && ct) overrides.set(normalizePartUri(partName), ct);
    }
  }

  return { defaults, overrides };
}

/** Resolve the content type for a part URI using overrides then defaults. */
export function resolveContentType(
  model: ContentTypesModel,
  uri: PartUri,
): string | undefined {
  const normalized = normalizePartUri(uri);
  const override = model.overrides.get(normalized);
  if (override) return override;

  const dotIdx = uri.lastIndexOf(".");
  if (dotIdx !== -1) {
    const ext = uri.slice(dotIdx + 1).toLowerCase();
    return model.defaults.get(ext);
  }
  return undefined;
}

// ---- Serialization --------------------------------------------------------

const CONTENT_TYPES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/content-types";

/** Serialize a ContentTypesModel to valid [Content_Types].xml. */
export function serializeContentTypes(model: ContentTypesModel): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<Types xmlns="${CONTENT_TYPES_NAMESPACE}">`,
  ];

  for (const [ext, ct] of model.defaults) {
    lines.push(`  <Default Extension="${ext}" ContentType="${ct}"/>`);
  }
  for (const [uri, ct] of model.overrides) {
    lines.push(`  <Override PartName="${uri}" ContentType="${ct}"/>`);
  }

  lines.push("</Types>");
  return lines.join("\n");
}

// ---- Internals ------------------------------------------------------------

function normalizePartUri(uri: string): PartUri {
  return uri.startsWith("/") ? uri : "/" + uri;
}
