// ---------------------------------------------------------------------------
// Package-level step appliers
//
// Apply individual package-level mutation steps to the session. These modify
// session.parts, session.relationships, and session.contentTypes directly
// (within the transactional snapshot/rollback model of the engine).
// ---------------------------------------------------------------------------

import type { PackageSession } from "../types/session.js";
import type { XmlPart, BinaryPart } from "../types/package.js";
import type {
  PkgMutationStep,
  PkgAddPartStep,
  PkgRemovePartStep,
  PkgAddRelationshipStep,
  PkgRemoveRelationshipStep,
  PkgAddContentTypeOverrideStep,
  PkgRemoveContentTypeOverrideStep,
  PkgSetPartBytesStep,
  StepEffect,
} from "./types.js";
import { MutationError } from "./ref-resolver.js";
import { materializeNode } from "./materialize.js";
import { allocateRelationshipId } from "./id-allocation.js";
import { buildNodeIndex } from "./node-index.js";

/** Context passed to package step appliers. */
export type PkgStepContext = {
  session: PackageSession;
  nextNodeId: () => string;
};

/**
 * Apply a single package-level mutation step.
 * Returns a StepEffect and optionally the allocated relationship ID.
 */
export function applyPkgStep(
  step: PkgMutationStep,
  ctx: PkgStepContext,
): { effect: StepEffect; allocatedRelId?: string } {
  switch (step.kind) {
    case "pkg.addPart":
      return applyAddPart(step, ctx);
    case "pkg.removePart":
      return applyRemovePart(step, ctx);
    case "pkg.addRelationship":
      return applyAddRelationship(step, ctx);
    case "pkg.removeRelationship":
      return applyRemoveRelationship(step, ctx);
    case "pkg.addContentTypeOverride":
      return applyAddContentTypeOverride(step, ctx);
    case "pkg.removeContentTypeOverride":
      return applyRemoveContentTypeOverride(step, ctx);
    case "pkg.setPartBytes":
      return applySetPartBytes(step, ctx);
  }
}

// ---- Individual step appliers ---------------------------------------------

function applyAddPart(
  step: PkgAddPartStep,
  ctx: PkgStepContext,
): { effect: StepEffect } {
  const { session } = ctx;

  if (session.parts.has(step.uri)) {
    throw new MutationError(
      "structural-violation",
      `Part already exists: ${step.uri}`,
    );
  }

  if (isXmlContentType(step.contentType)) {
    // XML part — initialContent must be a SerializedXmlElement
    if (step.initialContent instanceof Uint8Array) {
      throw new MutationError(
        "structural-violation",
        `XML part "${step.uri}" requires SerializedXmlElement as initialContent, got Uint8Array`,
      );
    }

    const rootNode = materializeNode(step.initialContent, ctx.nextNodeId);
    if (rootNode.kind !== "element") {
      throw new MutationError(
        "structural-violation",
        `XML part root must be an element, got "${rootNode.kind}"`,
      );
    }

    const tree = {
      id: ctx.nextNodeId(),
      kind: "document" as const,
      children: [rootNode],
    };

    const part: XmlPart = {
      kind: "xml",
      uri: step.uri,
      contentType: step.contentType,
      source: { kind: "generated", bytes: new Uint8Array(0) },
      treeState: { kind: "mutated", tree },
      nodeIndex: buildNodeIndex(tree),
      dirty: true,
    };
    session.parts.set(step.uri, part);
  } else {
    // Binary part
    if (!(step.initialContent instanceof Uint8Array)) {
      throw new MutationError(
        "structural-violation",
        `Binary part "${step.uri}" requires Uint8Array as initialContent, got SerializedXmlElement`,
      );
    }

    const part: BinaryPart = {
      kind: "binary",
      uri: step.uri,
      contentType: step.contentType,
      source: { kind: "generated", bytes: step.initialContent },
      materializedBytes: step.initialContent,
      dirty: true,
    };
    session.parts.set(step.uri, part);
  }

  return {
    effect: {
      touchedPartUris: [step.uri],
      createdNodeIds: [],
      removedNodeIds: [],
      packageMetadataChanged: true,
    },
  };
}

function applyRemovePart(
  step: PkgRemovePartStep,
  ctx: PkgStepContext,
): { effect: StepEffect } {
  const { session } = ctx;

  if (!session.parts.has(step.uri)) {
    throw new MutationError("ref-not-found", `Part not found: ${step.uri}`);
  }

  // Remove the part
  session.parts.delete(step.uri);

  // Remove any relationships owned by this part
  session.relationships.partRelationships.delete(step.uri);

  // Remove content type override if present
  session.contentTypes.overrides.delete(step.uri);

  return {
    effect: {
      touchedPartUris: [step.uri],
      createdNodeIds: [],
      removedNodeIds: [],
      packageMetadataChanged: true,
    },
  };
}

function applyAddRelationship(
  step: PkgAddRelationshipStep,
  ctx: PkgStepContext,
): { effect: StepEffect; allocatedRelId?: string } {
  const { session } = ctx;

  const relId =
    step.assignRelId ?? allocateRelationshipId(session, step.ownerUri);

  const record = {
    id: relId,
    type: step.type,
    target: step.target,
  };

  if (step.ownerUri === "/") {
    // Package-level relationship
    if (session.relationships.packageRelationships.has(relId)) {
      throw new MutationError(
        "structural-violation",
        `Package relationship already exists: ${relId}`,
      );
    }
    session.relationships.packageRelationships.set(relId, record);
  } else {
    // Part-level relationship
    let partRels = session.relationships.partRelationships.get(step.ownerUri);
    if (!partRels) {
      partRels = new Map();
      session.relationships.partRelationships.set(step.ownerUri, partRels);
    }
    if (partRels.has(relId)) {
      throw new MutationError(
        "structural-violation",
        `Relationship already exists: ${relId} on ${step.ownerUri}`,
      );
    }
    partRels.set(relId, record);
  }

  return {
    effect: {
      touchedPartUris: [],
      createdNodeIds: [],
      removedNodeIds: [],
      packageMetadataChanged: true,
    },
    allocatedRelId: relId,
  };
}

function applyRemoveRelationship(
  step: PkgRemoveRelationshipStep,
  ctx: PkgStepContext,
): { effect: StepEffect } {
  const { session } = ctx;

  if (step.ownerUri === "/") {
    if (!session.relationships.packageRelationships.has(step.relationshipId)) {
      throw new MutationError(
        "ref-not-found",
        `Package relationship not found: ${step.relationshipId}`,
      );
    }
    session.relationships.packageRelationships.delete(step.relationshipId);
  } else {
    const partRels = session.relationships.partRelationships.get(step.ownerUri);
    if (!partRels || !partRels.has(step.relationshipId)) {
      throw new MutationError(
        "ref-not-found",
        `Relationship not found: ${step.relationshipId} on ${step.ownerUri}`,
      );
    }
    partRels.delete(step.relationshipId);
  }

  return {
    effect: {
      touchedPartUris: [],
      createdNodeIds: [],
      removedNodeIds: [],
      packageMetadataChanged: true,
    },
  };
}

function applyAddContentTypeOverride(
  step: PkgAddContentTypeOverrideStep,
  ctx: PkgStepContext,
): { effect: StepEffect } {
  const { session } = ctx;
  const uri = normalizePartUri(step.partUri);
  session.contentTypes.overrides.set(uri, step.contentType);

  return {
    effect: {
      touchedPartUris: [],
      createdNodeIds: [],
      removedNodeIds: [],
      packageMetadataChanged: true,
    },
  };
}

function applyRemoveContentTypeOverride(
  step: PkgRemoveContentTypeOverrideStep,
  ctx: PkgStepContext,
): { effect: StepEffect } {
  const { session } = ctx;
  const uri = normalizePartUri(step.partUri);

  if (!session.contentTypes.overrides.has(uri)) {
    throw new MutationError(
      "ref-not-found",
      `Content type override not found: ${uri}`,
    );
  }

  session.contentTypes.overrides.delete(uri);

  return {
    effect: {
      touchedPartUris: [],
      createdNodeIds: [],
      removedNodeIds: [],
      packageMetadataChanged: true,
    },
  };
}

function applySetPartBytes(
  step: PkgSetPartBytesStep,
  ctx: PkgStepContext,
): { effect: StepEffect } {
  const { session } = ctx;
  const part = session.parts.get(step.uri);

  if (!part) {
    throw new MutationError("ref-not-found", `Part not found: ${step.uri}`);
  }

  if (part.kind !== "binary") {
    throw new MutationError(
      "structural-violation",
      `pkg.setPartBytes only applies to binary parts, "${step.uri}" is ${part.kind}`,
    );
  }

  part.materializedBytes = step.bytes;
  part.source = { kind: "generated", bytes: step.bytes };
  part.dirty = true;

  return {
    effect: {
      touchedPartUris: [step.uri],
      createdNodeIds: [],
      removedNodeIds: [],
      packageMetadataChanged: false,
    },
  };
}

// ---- Helpers --------------------------------------------------------------

/** Determine if a content type represents XML content. */
function isXmlContentType(ct: string): boolean {
  return ct.endsWith("+xml") || ct.endsWith("/xml") || ct.startsWith("application/xml");
}

/** Ensure a part URI starts with "/". */
function normalizePartUri(uri: string): string {
  return uri.startsWith("/") ? uri : "/" + uri;
}
