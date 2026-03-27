// ---------------------------------------------------------------------------
// Fact Emitter
// ---------------------------------------------------------------------------
// Converts SAX events into RawSurfaceFact records. This is the bridge between
// the XML event stream and the raw fact model.
// ---------------------------------------------------------------------------

import type { RawSurfaceFact, QualifiedName, PartKind } from './types.js';
import { PathState } from './path-state.js';
import { buildSourceRef } from './source-ref.js';
import { buildRawFactId } from './fact-id.js';
import { normalizeValue } from './value-normalization.js';
import { formatQName } from './namespace-format.js';

export type FactEmitterContext = {
  docId: string;
  docFingerprint: string;
  partUri: string;
  partKind: PartKind;
  pathState: PathState;
};

/** Emit an element fact for the current path state position. */
export function emitElementFact(
  ctx: FactEmitterContext,
  qname: QualifiedName,
  line?: number,
  column?: number,
): RawSurfaceFact {
  const pathSignature = ctx.pathState.getPathSignature();
  const xpathLikePath = ctx.pathState.getXpathLikePath();
  const mcContext = ctx.pathState.getMcContext();

  return {
    rawFactId: buildRawFactId(ctx.docId, ctx.partUri, 'element', xpathLikePath),
    docId: ctx.docId,
    docFingerprint: ctx.docFingerprint,
    partUri: ctx.partUri,
    partKind: ctx.partKind,
    factKind: 'element',
    pathSignature,
    xpathLikePath,
    sourceRef: buildSourceRef(ctx.partUri, xpathLikePath, line, column),
    qname,
    markupCompatibilityContext: mcContext.alternateContentDepth > 0 ? mcContext : undefined,
    parentPathSignature: ctx.pathState.getParentPathSignature(),
  };
}

/** Emit attribute facts for all attributes on the current element. */
export function emitAttributeFacts(
  ctx: FactEmitterContext,
  attributes: Record<string, { prefix: string; local: string; uri: string; value: string }>,
  line?: number,
  column?: number,
): RawSurfaceFact[] {
  const facts: RawSurfaceFact[] = [];
  const mcContext = ctx.pathState.getMcContext();

  // Sort attribute names for deterministic output
  const sortedNames = Object.keys(attributes).sort();

  for (const key of sortedNames) {
    const attr = attributes[key];
    const attrQName: QualifiedName = {
      prefix: attr.prefix || undefined,
      localName: attr.local,
      namespaceUri: attr.uri || undefined,
    };

    const formattedAttrName = formatQName(attrQName);
    const pathSignature = ctx.pathState.getAttributePathSignature(formattedAttrName);
    const xpathLikePath = ctx.pathState.getAttributeXpathLikePath(formattedAttrName);

    facts.push({
      rawFactId: buildRawFactId(ctx.docId, ctx.partUri, 'attribute', xpathLikePath),
      docId: ctx.docId,
      docFingerprint: ctx.docFingerprint,
      partUri: ctx.partUri,
      partKind: ctx.partKind,
      factKind: 'attribute',
      pathSignature,
      xpathLikePath,
      sourceRef: buildSourceRef(ctx.partUri, xpathLikePath, line, column),
      qname: undefined,
      attributeName: attrQName,
      value: normalizeValue(attr.value),
      markupCompatibilityContext: mcContext.alternateContentDepth > 0 ? mcContext : undefined,
      parentPathSignature: ctx.pathState.getPathSignature(),
    });
  }

  return facts;
}

/** Emit a processing instruction fact. */
export function emitProcessingInstructionFact(
  ctx: FactEmitterContext,
  target: string,
  piIndex: number,
  line?: number,
  column?: number,
): RawSurfaceFact {
  const parentSig = ctx.pathState.getPathSignature();
  const parentXpath = ctx.pathState.getXpathLikePath();
  const pathSignature = `${parentSig}/processing-instruction(${target})`;
  const xpathLikePath = `${parentXpath}/processing-instruction(${target})[${piIndex}]`;
  const mcContext = ctx.pathState.getMcContext();

  return {
    rawFactId: buildRawFactId(ctx.docId, ctx.partUri, 'processing-instruction', xpathLikePath),
    docId: ctx.docId,
    docFingerprint: ctx.docFingerprint,
    partUri: ctx.partUri,
    partKind: ctx.partKind,
    factKind: 'processing-instruction',
    pathSignature,
    xpathLikePath,
    sourceRef: buildSourceRef(ctx.partUri, xpathLikePath, line, column),
    qname: { localName: target },
    markupCompatibilityContext: mcContext.alternateContentDepth > 0 ? mcContext : undefined,
    parentPathSignature: parentSig,
  };
}

/** Emit a comment fact. */
export function emitCommentFact(
  ctx: FactEmitterContext,
  commentIndex: number,
  line?: number,
  column?: number,
): RawSurfaceFact {
  const parentSig = ctx.pathState.getPathSignature();
  const parentXpath = ctx.pathState.getXpathLikePath();
  const pathSignature = `${parentSig}/comment()`;
  const xpathLikePath = `${parentXpath}/comment()[${commentIndex}]`;
  const mcContext = ctx.pathState.getMcContext();

  return {
    rawFactId: buildRawFactId(ctx.docId, ctx.partUri, 'comment', xpathLikePath),
    docId: ctx.docId,
    docFingerprint: ctx.docFingerprint,
    partUri: ctx.partUri,
    partKind: ctx.partKind,
    factKind: 'comment',
    pathSignature,
    xpathLikePath,
    sourceRef: buildSourceRef(ctx.partUri, xpathLikePath, line, column),
    markupCompatibilityContext: mcContext.alternateContentDepth > 0 ? mcContext : undefined,
    parentPathSignature: parentSig,
  };
}
