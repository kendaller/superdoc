// ---------------------------------------------------------------------------
// Drawing property extractor
//
// Reads a `w:drawing` element and extracts basic drawing properties.
// Handles both inline (`wp:inline`) and anchored (`wp:anchor`) drawings.
// Classifies drawing type (image, shape, chart, group) from child content.
// ---------------------------------------------------------------------------

import type { XmlElementNode } from "../types/xml.js";
import type { DrawingRawProperties } from "../entities/types.js";
import { findChildElement, getAttr } from "../word/tree-helpers.js";

export function extractDrawingProperties(element: XmlElementNode): DrawingRawProperties {
  const inlineEl = findChildElement(element, "inline", "wp");
  const anchorEl = findChildElement(element, "anchor", "wp");
  const container = inlineEl ?? anchorEl;
  const isInline = inlineEl !== undefined;

  if (!container) {
    return {
      isInline: true,
      width: undefined,
      height: undefined,
      description: undefined,
      blipRelId: undefined,
      drawingType: "unknown",
    };
  }

  const extent = findChildElement(container, "extent", "wp");
  const docPr = findChildElement(container, "docPr", "wp");
  const { blipRelId, drawingType } = classifyDrawingContent(container);

  return {
    isInline,
    width: extent ? optionalNumber(getAttr(extent, "cx")) : undefined,
    height: extent ? optionalNumber(getAttr(extent, "cy")) : undefined,
    description: docPr ? (getAttr(docPr, "descr") ?? getAttr(docPr, "title")) : undefined,
    blipRelId,
    drawingType,
  };
}

/** Walk into the graphic frame to classify drawing type and find blip rId. */
function classifyDrawingContent(container: XmlElementNode): {
  blipRelId: string | undefined;
  drawingType: DrawingRawProperties["drawingType"];
} {
  // wp:inline/wp:anchor → a:graphic → a:graphicData → content
  const graphic = findChildElement(container, "graphic", "a");
  if (!graphic) return { blipRelId: undefined, drawingType: "unknown" };

  const graphicData = findChildElement(graphic, "graphicData", "a");
  if (!graphicData) return { blipRelId: undefined, drawingType: "unknown" };

  const uri = getAttr(graphicData, "uri");

  // Picture namespace → image
  const pic = findChildElement(graphicData, "pic", "pic")
    ?? findChildElement(graphicData, "pic", "xdr");
  if (pic) {
    const blipFill = findChildElement(pic, "blipFill", "pic");
    const blip = blipFill ? findChildElement(blipFill, "blip", "a") : undefined;
    const rId = blip ? (getAttr(blip, "embed", "r") ?? getAttr(blip, "link", "r")) : undefined;
    return { blipRelId: rId, drawingType: "image" };
  }

  // Chart
  if (uri?.includes("chart") || findChildElement(graphicData, "chart", "c")) {
    return { blipRelId: undefined, drawingType: "chart" };
  }

  // WordprocessingShape (wsp) or group shape (wpg)
  if (findChildElement(graphicData, "wsp", "wps")) {
    return { blipRelId: undefined, drawingType: "shape" };
  }
  if (findChildElement(graphicData, "wgp", "wpg")) {
    return { blipRelId: undefined, drawingType: "group" };
  }

  return { blipRelId: undefined, drawingType: "unknown" };
}

function optionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}
