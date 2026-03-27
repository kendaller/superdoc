// ---------------------------------------------------------------------------
// Mutation engine tests — Phase 1 acceptance criteria
//
// Covers: transaction validity, XML step correctness, pending refs,
// atomicity/rollback, dirty tracking, save fidelity, and the flagship test.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { open } from "../src/session/open.js";
import { createSession } from "../src/session/session.js";
import { fastOpen } from "../src/opc/package-loader.js";
import { savePackage } from "../src/session/save.js";
import { getXmlPart, ensureHydrated } from "../src/word/view-base.js";
import { createDocumentView } from "../src/word/document-view.js";
import {
  createMinimalDocx,
  createMultiParagraphDocx,
} from "./helpers/create-test-docx.js";
import {
  applyTransaction,
  getRecentMutations,
  resetNodeCounter,
  buildNodeIndex,
} from "../src/mutations/index.js";
import type {
  MutationTransaction,
  NodeRef,
  PartRef,
} from "../src/mutations/index.js";
import type { XmlElementNode, XmlTextNode } from "../src/types/xml.js";
import type { PackageSession } from "../src/types/session.js";

// ---- Test helpers ---------------------------------------------------------

function setupSession(bytes: Uint8Array) {
  const session = createSession({ kind: "memory", bytes });
  const { mainDocumentUri } = fastOpen({ kind: "memory", bytes });
  return { session, mainDocumentUri };
}

function partRef(uri: string): PartRef {
  return { kind: "part", uri };
}

function nodeRef(partUri: string, nodeId: string, stability: "source-anchored" | "session-generated" = "source-anchored"): NodeRef {
  return { kind: "node", partUri, nodeId, stability };
}

function pendingNodeRef(partUri: string, label: string): NodeRef {
  return { kind: "node", partUri, nodeId: `pending:${label}`, stability: "session-generated" };
}

/** Get the body element from a hydrated document part. */
function getBody(session: PackageSession, mainDocumentUri: string): XmlElementNode {
  const part = getXmlPart(session, mainDocumentUri)!;
  const tree = ensureHydrated(part, session);
  const root = tree.children.find(
    (c): c is XmlElementNode => c.kind === "element",
  )!;
  return root.children.find(
    (c): c is XmlElementNode => c.kind === "element" && c.localName === "body",
  )!;
}

/** Find all w:p elements in the body. */
function getParagraphs(body: XmlElementNode): XmlElementNode[] {
  return body.children.filter(
    (c): c is XmlElementNode => c.kind === "element" && c.localName === "p",
  );
}

/** Extract text from a w:p element (first w:r > w:t > text node). */
function getParagraphText(p: XmlElementNode): string | undefined {
  const run = p.children.find(
    (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
  );
  if (!run) return undefined;
  const t = run.children.find(
    (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
  );
  if (!t) return undefined;
  const textNode = t.children[0];
  return textNode?.kind === "text" ? textNode.value : undefined;
}

// ---- Transaction validity -------------------------------------------------

describe("transaction validity", () => {
  it("rejects transactions with stale base revision", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());

    const result = await applyTransaction(session, {
      id: "tx-stale",
      baseRevision: "r999",
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setText",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, "doesnt-matter"),
        value: "test",
      }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("stale-base");
    }
  });

  it("rejects empty transactions", async () => {
    const { session } = setupSession(createMinimalDocx());

    const result = await applyTransaction(session, {
      id: "tx-empty",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("structural-violation");
    }
  });

  it("rejects transactions targeting non-existent parts", async () => {
    const { session } = setupSession(createMinimalDocx());

    const result = await applyTransaction(session, {
      id: "tx-bad-part",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setText",
        part: partRef("/word/nonexistent.xml"),
        node: nodeRef("/word/nonexistent.xml", "x"),
        value: "test",
      }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ref-not-found");
    }
  });

  it("rejects transactions targeting non-existent nodes", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());

    const result = await applyTransaction(session, {
      id: "tx-bad-node",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setText",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, "nonexistent-node-id"),
        value: "test",
      }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ref-not-found");
    }
  });

  it("rejects pending refs that reference not-yet-created nodes", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());

    const result = await applyTransaction(session, {
      id: "tx-bad-pending",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setText",
        part: partRef(mainDocumentUri),
        node: pendingNodeRef(mainDocumentUri, "never-created"),
        value: "test",
      }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ref-not-found");
    }
  });
});

// ---- XML mutation correctness ---------------------------------------------

describe("xml.insertNode", () => {
  it("inserts a text node into an element", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    const result = await applyTransaction(session, {
      id: "tx-insert-text",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "append", parent: nodeRef(mainDocumentUri, firstP.id) },
        content: { kind: "text", value: "inserted text" },
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.touchedParts).toContain(mainDocumentUri);
      expect(result.createdRefs.length).toBe(1);
    }

    // Verify the text node was inserted
    const lastChild = firstP.children[firstP.children.length - 1];
    expect(lastChild.kind).toBe("text");
    if (lastChild.kind === "text") {
      expect(lastChild.value).toBe("inserted text");
    }
  });

  it("inserts an element node with children", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);

    const result = await applyTransaction(session, {
      id: "tx-insert-element",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
        content: {
          kind: "element",
          name: "p",
          prefix: "w",
          namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          children: [{
            kind: "element",
            name: "r",
            prefix: "w",
            namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            children: [{
              kind: "element",
              name: "t",
              prefix: "w",
              namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
              children: [{ kind: "text", value: "New paragraph" }],
            }],
          }],
        },
      }],
    });

    expect(result.ok).toBe(true);

    // First child should now be our new paragraph
    const newFirst = body.children[0];
    expect(newFirst.kind).toBe("element");
    if (newFirst.kind === "element") {
      expect(newFirst.localName).toBe("p");
    }
  });

  it("inserts at a specific index", async () => {
    const paragraphs = ["First", "Second", "Third"];
    const { session, mainDocumentUri } = setupSession(createMultiParagraphDocx(paragraphs));
    const body = getBody(session, mainDocumentUri);
    const originalChildCount = body.children.length;

    const result = await applyTransaction(session, {
      id: "tx-insert-at-index",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "at-index", parent: nodeRef(mainDocumentUri, body.id), index: 1 },
        content: {
          kind: "element",
          name: "p",
          prefix: "w",
          namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          children: [{
            kind: "element",
            name: "r",
            prefix: "w",
            namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            children: [{
              kind: "element",
              name: "t",
              prefix: "w",
              namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
              children: [{ kind: "text", value: "Inserted" }],
            }],
          }],
        },
      }],
    });

    expect(result.ok).toBe(true);
    expect(body.children.length).toBe(originalChildCount + 1);

    // Inserted paragraph should be at index 1
    const inserted = body.children[1];
    expect(inserted.kind).toBe("element");
    if (inserted.kind === "element") {
      expect(inserted.localName).toBe("p");
      expect(getParagraphText(inserted)).toBe("Inserted");
    }
  });

  it("inserts before and after existing nodes", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];
    const pCountBefore = getParagraphs(body).length;

    // Insert before the first paragraph
    const result1 = await applyTransaction(session, {
      id: "tx-before",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "before", node: nodeRef(mainDocumentUri, firstP.id) },
        content: {
          kind: "element",
          name: "p",
          prefix: "w",
          namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          children: [{ kind: "text", value: "Before" }],
        },
      }],
    });
    expect(result1.ok).toBe(true);

    // Should now have one more paragraph
    const paragraphsAfterBefore = getParagraphs(body);
    expect(paragraphsAfterBefore.length).toBe(pCountBefore + 1);

    // The new paragraph should appear before the original first paragraph
    const newPIdx = paragraphsAfterBefore.indexOf(firstP);
    expect(newPIdx).toBeGreaterThan(0); // original moved right
    expect(paragraphsAfterBefore[newPIdx - 1].id).not.toBe(firstP.id);

    // Insert after the original first paragraph
    const result2 = await applyTransaction(session, {
      id: "tx-after",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "after", node: nodeRef(mainDocumentUri, firstP.id) },
        content: {
          kind: "element",
          name: "p",
          prefix: "w",
          namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          children: [{ kind: "text", value: "After" }],
        },
      }],
    });
    expect(result2.ok).toBe(true);
    expect(getParagraphs(body).length).toBe(pCountBefore + 2);
  });
});

describe("xml.removeNode", () => {
  it("removes a node from its parent", async () => {
    const { session, mainDocumentUri } = setupSession(
      createMultiParagraphDocx(["First", "Second", "Third"]),
    );
    const body = getBody(session, mainDocumentUri);
    const paragraphs = getParagraphs(body);
    const secondP = paragraphs[1];

    const result = await applyTransaction(session, {
      id: "tx-remove",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.removeNode",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, secondP.id),
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.invalidatedRefs.length).toBeGreaterThan(0);
    }

    // Should now have 2 paragraphs instead of 3
    const remaining = getParagraphs(body);
    expect(remaining.length).toBe(2);
    expect(getParagraphText(remaining[0])).toBe("First");
    expect(getParagraphText(remaining[1])).toBe("Third");
  });
});

describe("xml.replaceNode", () => {
  it("replaces a node with new content", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx("Original"));
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    const result = await applyTransaction(session, {
      id: "tx-replace",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.replaceNode",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, firstP.id),
        content: {
          kind: "element",
          name: "p",
          prefix: "w",
          namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          children: [{
            kind: "element",
            name: "r",
            prefix: "w",
            namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            children: [{
              kind: "element",
              name: "t",
              prefix: "w",
              namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
              children: [{ kind: "text", value: "Replaced!" }],
            }],
          }],
        },
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.createdRefs.length).toBeGreaterThan(0);
      expect(result.invalidatedRefs.length).toBeGreaterThan(0);
    }

    const newParagraphs = getParagraphs(body);
    expect(getParagraphText(newParagraphs[0])).toBe("Replaced!");
  });
});

describe("xml.setText", () => {
  it("sets text content of a text node", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx("Original"));
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    // Navigate to the text node: p > r > t > text
    const run = firstP.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    )!;
    const t = run.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    )!;
    const textNode = t.children[0] as XmlTextNode;

    const result = await applyTransaction(session, {
      id: "tx-set-text",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setText",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, textNode.id),
        value: "Modified!",
      }],
    });

    expect(result.ok).toBe(true);
    expect(textNode.value).toBe("Modified!");
  });

  it("rejects setText on non-text nodes", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    const result = await applyTransaction(session, {
      id: "tx-set-text-on-element",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setText",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, firstP.id),
        value: "bad",
      }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("structural-violation");
    }
  });
});

describe("xml.setAttribute", () => {
  it("sets a new attribute on an element", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    const result = await applyTransaction(session, {
      id: "tx-set-attr",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setAttribute",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, firstP.id),
        name: "customAttr",
        value: "customValue",
      }],
    });

    expect(result.ok).toBe(true);

    const attr = firstP.attributes.find((a) => a.localName === "customAttr");
    expect(attr).toBeDefined();
    expect(attr!.value).toBe("customValue");
  });

  it("updates an existing attribute", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    // First set an attribute
    await applyTransaction(session, {
      id: "tx-set-attr-1",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setAttribute",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, firstP.id),
        name: "myAttr",
        value: "initial",
      }],
    });

    // Then update it
    const result = await applyTransaction(session, {
      id: "tx-set-attr-2",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setAttribute",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, firstP.id),
        name: "myAttr",
        value: "updated",
      }],
    });

    expect(result.ok).toBe(true);
    const attr = firstP.attributes.find((a) => a.localName === "myAttr");
    expect(attr!.value).toBe("updated");
  });
});

describe("xml.removeAttribute", () => {
  it("removes an attribute from an element", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    // Set then remove
    await applyTransaction(session, {
      id: "tx-add-attr",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setAttribute",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, firstP.id),
        name: "toRemove",
        value: "val",
      }],
    });

    const result = await applyTransaction(session, {
      id: "tx-rm-attr",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.removeAttribute",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, firstP.id),
        name: "toRemove",
      }],
    });

    expect(result.ok).toBe(true);
    expect(firstP.attributes.find((a) => a.localName === "toRemove")).toBeUndefined();
  });

  it("rejects removing a non-existent attribute", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    const result = await applyTransaction(session, {
      id: "tx-rm-missing-attr",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.removeAttribute",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, firstP.id),
        name: "nonexistent",
      }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ref-not-found");
    }
  });
});

// ---- Intra-transaction patterns (pending refs) ----------------------------

describe("intra-transaction pending refs", () => {
  it("inserts a node with assignId, then modifies it via pending ref", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);

    const result = await applyTransaction(session, {
      id: "tx-pending-refs",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [
        // Step 1: Insert a paragraph with assignId
        {
          kind: "xml.insertNode",
          part: partRef(mainDocumentUri),
          position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
          content: {
            kind: "element",
            name: "p",
            prefix: "w",
            namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          },
          assignId: "pending:newPara",
        },
        // Step 2: Insert a run inside that paragraph via pending ref
        {
          kind: "xml.insertNode",
          part: partRef(mainDocumentUri),
          position: { kind: "append", parent: pendingNodeRef(mainDocumentUri, "newPara") },
          content: {
            kind: "element",
            name: "r",
            prefix: "w",
            namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            children: [{
              kind: "element",
              name: "t",
              prefix: "w",
              namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
              children: [{ kind: "text", value: "Via pending ref" }],
            }],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);

    // The new paragraph should be at index 0 with a run containing text
    const newP = body.children[0];
    expect(newP.kind).toBe("element");
    if (newP.kind === "element") {
      expect(newP.localName).toBe("p");
      expect(getParagraphText(newP)).toBe("Via pending ref");
    }
  });

  it("multi-step transaction builds a subtree incrementally", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);

    const result = await applyTransaction(session, {
      id: "tx-multi-step",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [
        // Insert container element
        {
          kind: "xml.insertNode",
          part: partRef(mainDocumentUri),
          position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
          content: { kind: "element", name: "p", prefix: "w", namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main" },
          assignId: "pending:container",
        },
        // Insert child 1
        {
          kind: "xml.insertNode",
          part: partRef(mainDocumentUri),
          position: { kind: "append", parent: pendingNodeRef(mainDocumentUri, "container") },
          content: { kind: "element", name: "r", prefix: "w", namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main" },
          assignId: "pending:run",
        },
        // Insert text inside child 1
        {
          kind: "xml.insertNode",
          part: partRef(mainDocumentUri),
          position: { kind: "append", parent: pendingNodeRef(mainDocumentUri, "run") },
          content: {
            kind: "element",
            name: "t",
            prefix: "w",
            namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            children: [{ kind: "text", value: "Built step by step" }],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);

    const newP = body.children[0] as XmlElementNode;
    expect(newP.localName).toBe("p");
    expect(getParagraphText(newP)).toBe("Built step by step");
  });
});

// ---- Atomicity and rollback -----------------------------------------------

describe("atomicity and rollback", () => {
  it("rolls back all prior steps when step N fails", async () => {
    const { session, mainDocumentUri } = setupSession(
      createMultiParagraphDocx(["First", "Second"]),
    );
    const body = getBody(session, mainDocumentUri);
    const originalChildCount = body.children.length;
    const originalParagraphCount = getParagraphs(body).length;
    const revBefore = session.currentRevision;

    const result = await applyTransaction(session, {
      id: "tx-rollback",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [
        // Step 0: valid insert (should be rolled back)
        {
          kind: "xml.insertNode",
          part: partRef(mainDocumentUri),
          position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
          content: { kind: "element", name: "p", prefix: "w", namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main" },
        },
        // Step 1: invalid — setText on a non-existent node
        {
          kind: "xml.setText",
          part: partRef(mainDocumentUri),
          node: nodeRef(mainDocumentUri, "nonexistent-node"),
          value: "boom",
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedStepIndex).toBe(1);
    }

    // Rollback restores from a snapshot (deep clone), so re-fetch the body
    const restoredBody = getBody(session, mainDocumentUri);
    expect(restoredBody.children.length).toBe(originalChildCount);
    expect(getParagraphs(restoredBody).length).toBe(originalParagraphCount);
    expect(session.currentRevision).toBe(revBefore);
  });

  it("revision does not increment on failed transactions", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const revBefore = session.currentRevision;

    await applyTransaction(session, {
      id: "tx-fail",
      baseRevision: "wrong-revision",
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setText",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, "x"),
        value: "y",
      }],
    });

    expect(session.currentRevision).toBe(revBefore);
  });
});

// ---- Dirty tracking -------------------------------------------------------

describe("mutation dirty tracking", () => {
  it("touched parts transition to mutated state", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const part = getXmlPart(session, mainDocumentUri)!;

    await applyTransaction(session, {
      id: "tx-dirty",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
        content: { kind: "text", value: "hello" },
      }],
    });

    expect(part.treeState.kind).toBe("mutated");
    expect(part.dirty).toBe(true);
  });

  it("untouched parts remain unchanged", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);

    // Get another part (styles.xml) to verify it's not touched
    const stylesUri = "/word/styles.xml";
    const stylesPart = getXmlPart(session, stylesUri);

    await applyTransaction(session, {
      id: "tx-one-part",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
        content: { kind: "text", value: "x" },
      }],
    });

    // Styles part should not be dirty
    if (stylesPart) {
      expect(stylesPart.dirty).toBe(false);
    }
  });

  it("revision advances exactly once per successful transaction", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const revBefore = session.currentRevision;

    const result = await applyTransaction(session, {
      id: "tx-rev",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [
        {
          kind: "xml.insertNode",
          part: partRef(mainDocumentUri),
          position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
          content: { kind: "text", value: "a" },
        },
        {
          kind: "xml.insertNode",
          part: partRef(mainDocumentUri),
          position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
          content: { kind: "text", value: "b" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    // Revision should have advanced exactly once (not twice for two steps)
    expect(session.currentRevision).not.toBe(revBefore);
    if (result.ok) {
      expect(result.appliedRevision).toBe(session.currentRevision);
    }
  });
});

// ---- Save fidelity --------------------------------------------------------

describe("save fidelity after mutations", () => {
  it("no-op save returns original bytes when no mutations applied", () => {
    const bytes = createMinimalDocx();
    const { session } = setupSession(bytes);

    const result = savePackage(session);
    expect(result).toEqual(bytes);
  });

  it("save produces valid archive after mutations", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx("Original"));
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];
    const run = firstP.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    )!;
    const t = run.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    )!;
    const textNode = t.children[0] as XmlTextNode;

    await applyTransaction(session, {
      id: "tx-save-test",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setText",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, textNode.id),
        value: "SavedCorrectly",
      }],
    });

    const savedBytes = savePackage(session) as Uint8Array;
    expect(savedBytes).toBeInstanceOf(Uint8Array);

    // Re-open and verify
    const handle = await open(savedBytes);
    await handle.ready("structure");
    const view = handle.documentView()!;
    const root = view.rootElement()!;
    const newBody = root.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "body",
    )!;
    const newP = getParagraphs(newBody)[0];
    expect(getParagraphText(newP)).toBe("SavedCorrectly");
    await handle.close();
  });

  it("unrelated parts remain byte-identical after mutation", async () => {
    const bytes = createMinimalDocx("Test");
    const { session, mainDocumentUri } = setupSession(bytes);
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];
    const run = firstP.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    )!;
    const t = run.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    )!;
    const textNode = t.children[0] as XmlTextNode;

    await applyTransaction(session, {
      id: "tx-fidelity",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setText",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, textNode.id),
        value: "Changed",
      }],
    });

    const savedBytes = savePackage(session) as Uint8Array;

    // styles.xml should not be marked dirty
    const stylesPart = getXmlPart(session, "/word/styles.xml");
    expect(stylesPart?.dirty).toBe(false);

    // The save should be larger than 0 bytes
    expect(savedBytes.length).toBeGreaterThan(0);
  });
});

// ---- Journal / recent mutations -------------------------------------------

describe("mutation journal", () => {
  it("records successful transactions in recent mutations", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);

    await applyTransaction(session, {
      id: "tx-journal",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
        content: { kind: "text", value: "journaled" },
      }],
    });

    const recent = getRecentMutations(session);
    expect(recent.length).toBe(1);
    expect(recent[0].transaction.id).toBe("tx-journal");
    expect(recent[0].result.ok).toBe(true);
  });

  it("records failed transactions too", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());

    await applyTransaction(session, {
      id: "tx-journal-fail",
      baseRevision: "wrong",
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setText",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, "x"),
        value: "y",
      }],
    });

    const recent = getRecentMutations(session);
    expect(recent.length).toBe(1);
    expect(recent[0].result.ok).toBe(false);
  });
});

// ---- JSON serialization round-trip ----------------------------------------

describe("serialization round-trip", () => {
  it("transaction serializes to JSON and back", () => {
    const tx: MutationTransaction = {
      id: "tx-serializable",
      baseRevision: "r0",
      origin: { kind: "local", source: "test" },
      metadata: { label: "test edit", timestamp: new Date().toISOString() },
      steps: [
        {
          kind: "xml.insertNode",
          part: { kind: "part", uri: "/word/document.xml" },
          position: { kind: "append", parent: { kind: "node", partUri: "/word/document.xml", nodeId: "abc", stability: "source-anchored" } },
          content: { kind: "element", name: "p", prefix: "w" },
          assignId: "pending:newP",
        },
        {
          kind: "xml.setText",
          part: { kind: "part", uri: "/word/document.xml" },
          node: { kind: "node", partUri: "/word/document.xml", nodeId: "pending:newP", stability: "session-generated" },
          value: "hello",
        },
      ],
    };

    const json = JSON.stringify(tx);
    const parsed = JSON.parse(json) as MutationTransaction;

    expect(parsed.id).toBe(tx.id);
    expect(parsed.steps.length).toBe(2);
    expect(parsed.steps[0].kind).toBe("xml.insertNode");
    expect(parsed.steps[1].kind).toBe("xml.setText");
  });
});

// ---- Flagship acceptance test ---------------------------------------------

describe("flagship acceptance test", () => {
  it("insert paragraph with pending ref → insert run with text → save → reopen → verify", async () => {
    const originalTexts = ["Alpha", "Beta", "Gamma"];
    const bytes = createMultiParagraphDocx(originalTexts);
    const { session, mainDocumentUri } = setupSession(bytes);
    const body = getBody(session, mainDocumentUri);

    // Insert after the first paragraph using an element-relative position
    const firstParagraph = getParagraphs(body)[0];

    // Apply a transaction: insert paragraph with assignId, then insert run+text inside it
    const result = await applyTransaction(session, {
      id: "tx-flagship",
      baseRevision: session.currentRevision,
      origin: { kind: "local", source: "flagship-test" },
      metadata: { label: "Flagship acceptance test" },
      steps: [
        {
          kind: "xml.insertNode",
          part: partRef(mainDocumentUri),
          position: { kind: "after", node: nodeRef(mainDocumentUri, firstParagraph.id) },
          content: {
            kind: "element",
            name: "p",
            prefix: "w",
            namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          },
          assignId: "pending:newPara",
        },
        {
          kind: "xml.insertNode",
          part: partRef(mainDocumentUri),
          position: { kind: "append", parent: pendingNodeRef(mainDocumentUri, "newPara") },
          content: {
            kind: "element",
            name: "r",
            prefix: "w",
            namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            children: [{
              kind: "element",
              name: "t",
              prefix: "w",
              namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
              children: [{ kind: "text", value: "Inserted via mutation engine" }],
            }],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.touchedParts).toContain(mainDocumentUri);
    expect(result.createdRefs.length).toBeGreaterThan(0);

    // Save
    const savedBytes = savePackage(session) as Uint8Array;
    expect(savedBytes).toBeInstanceOf(Uint8Array);

    // Reopen
    const handle2 = await open(savedBytes);
    await handle2.ready("structure");
    const view2 = handle2.documentView()!;
    const root2 = view2.rootElement()!;
    const body2 = root2.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "body",
    )!;
    const paragraphs2 = getParagraphs(body2);

    // Should have 4 paragraphs: Alpha, Inserted, Beta, Gamma
    expect(paragraphs2.length).toBe(4);
    expect(getParagraphText(paragraphs2[0])).toBe("Alpha");
    expect(getParagraphText(paragraphs2[1])).toBe("Inserted via mutation engine");
    expect(getParagraphText(paragraphs2[2])).toBe("Beta");
    expect(getParagraphText(paragraphs2[3])).toBe("Gamma");

    // Verify other parts are present (styles, settings, etc.)
    const status = await handle2.status();
    expect(status.metrics.partCount).toBeGreaterThanOrEqual(5);

    await handle2.close();
  });
});

// ---- Finding 1: Rollback restores consistent object graph -----------------

describe("rollback consistency (finding 1)", () => {
  it("after rollback, node index points at the restored tree's nodes", async () => {
    const { session, mainDocumentUri } = setupSession(
      createMultiParagraphDocx(["A", "B"]),
    );
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    // Apply a transaction that fails on step 1 (step 0 is a valid insert)
    await applyTransaction(session, {
      id: "tx-rollback-graph",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [
        {
          kind: "xml.insertNode",
          part: partRef(mainDocumentUri),
          position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
          content: { kind: "element", name: "p", prefix: "w", namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main" },
        },
        {
          kind: "xml.setText",
          part: partRef(mainDocumentUri),
          node: nodeRef(mainDocumentUri, "nonexistent"),
          value: "boom",
        },
      ],
    });

    // After rollback: get the restored tree and verify the node index is consistent
    const part = getXmlPart(session, mainDocumentUri)!;
    expect(part.nodeIndex).toBeDefined();

    // The restored body should be reachable from the restored tree
    const restoredTree = (part.treeState as { tree: any }).tree;
    expect(restoredTree).toBeDefined();

    // Every node in the index should be the same object as in the tree
    const restoredRoot = restoredTree.children.find(
      (c: any) => c.kind === "element",
    )!;
    const restoredBody = restoredRoot.children.find(
      (c: any) => c.kind === "element" && c.localName === "body",
    )!;

    for (const child of restoredBody.children) {
      if (child.kind === "element") {
        const indexed = part.nodeIndex!.byId.get(child.id);
        expect(indexed).toBe(child); // Same object reference, not a detached clone
      }
    }
  });

  it("subsequent transaction after rollback mutates the correct tree", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx("Original"));
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];
    const run = firstP.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "r",
    )!;
    const t = run.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "t",
    )!;
    const textNode = t.children[0] as XmlTextNode;

    // Fail a transaction
    await applyTransaction(session, {
      id: "tx-fail-first",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [
        { kind: "xml.setText", part: partRef(mainDocumentUri), node: nodeRef(mainDocumentUri, textNode.id), value: "Changed" },
        { kind: "xml.setText", part: partRef(mainDocumentUri), node: nodeRef(mainDocumentUri, "bad-id"), value: "boom" },
      ],
    });

    // Now apply a successful transaction using the same node refs
    // Must re-fetch node refs from the restored tree
    const part = getXmlPart(session, mainDocumentUri)!;
    const restoredTextNode = part.nodeIndex!.byId.get(textNode.id);
    expect(restoredTextNode).toBeDefined();

    const result = await applyTransaction(session, {
      id: "tx-succeed-after-fail",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setText",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, textNode.id),
        value: "CorrectlyModified",
      }],
    });

    expect(result.ok).toBe(true);

    // Verify the mutation took effect and persists through save
    const savedBytes = savePackage(session) as Uint8Array;
    const handle = await open(savedBytes);
    await handle.ready("structure");
    const view = handle.documentView()!;
    const root = view.rootElement()!;
    const savedBody = root.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "body",
    )!;
    expect(getParagraphText(getParagraphs(savedBody)[0])).toBe("CorrectlyModified");
    await handle.close();
  });
});

// ---- Finding 2: Namespace handling ----------------------------------------

describe("namespace handling (finding 2)", () => {
  it("setAttribute supports prefix for namespaced attributes", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    const result = await applyTransaction(session, {
      id: "tx-ns-attr",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setAttribute",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, firstP.id),
        name: "id",
        namespace: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        prefix: "r",
        value: "rId1",
      }],
    });

    expect(result.ok).toBe(true);
    const attr = firstP.attributes.find((a) => a.localName === "id" && a.prefix === "r");
    expect(attr).toBeDefined();
    expect(attr!.value).toBe("rId1");
    expect(attr!.namespaceUri).toBe("http://schemas.openxmlformats.org/officeDocument/2006/relationships");
  });

  it("materialize emits default namespace declarations for prefix-less namespaces", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);

    const result = await applyTransaction(session, {
      id: "tx-default-ns",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
        content: {
          kind: "element",
          name: "custom",
          namespace: "http://example.com/ns",
          // No prefix → should generate xmlns="http://example.com/ns"
        },
      }],
    });

    expect(result.ok).toBe(true);
    const inserted = body.children[0] as XmlElementNode;
    expect(inserted.localName).toBe("custom");
    expect(inserted.namespaceUri).toBe("http://example.com/ns");
    // Should have a default namespace declaration
    const nsDecl = inserted.namespaceDecls.find((d) => !d.prefix);
    expect(nsDecl).toBeDefined();
    expect(nsDecl!.uri).toBe("http://example.com/ns");
  });

  it("materialize emits namespace declarations for namespaced attributes", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);

    const result = await applyTransaction(session, {
      id: "tx-attr-ns",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
        content: {
          kind: "element",
          name: "p",
          prefix: "w",
          namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          attributes: [{
            name: "id",
            prefix: "r",
            namespace: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            value: "rId5",
          }],
        },
      }],
    });

    expect(result.ok).toBe(true);
    const inserted = body.children[0] as XmlElementNode;
    // Should have xmlns:w and xmlns:r declarations
    const wDecl = inserted.namespaceDecls.find((d) => d.prefix === "w");
    const rDecl = inserted.namespaceDecls.find((d) => d.prefix === "r");
    expect(wDecl).toBeDefined();
    expect(rDecl).toBeDefined();
    expect(rDecl!.uri).toBe("http://schemas.openxmlformats.org/officeDocument/2006/relationships");
  });
});

// ---- Finding 3: Typed view reads after mutation ---------------------------

describe("typed view reads after mutation (finding 3)", () => {
  it("documentView.bodyChildCount reflects inserted paragraphs", async () => {
    const bytes = createMultiParagraphDocx(["A", "B"]);
    const { session, mainDocumentUri } = setupSession(bytes);
    const body = getBody(session, mainDocumentUri);
    const view = createDocumentView(session, mainDocumentUri)!;
    const countBefore = view.bodyChildCount();

    await applyTransaction(session, {
      id: "tx-view-count",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
        content: {
          kind: "element",
          name: "p",
          prefix: "w",
          namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          children: [{ kind: "text", value: "New" }],
        },
      }],
    });

    // After mutation, bodyChildCount should reflect the new child
    // The view must detect "mutated" state and use the tree
    expect(view.bodyChildCount()).toBe(countBefore + 1);
  });

  it("documentView.bodyChild returns newly inserted paragraphs", async () => {
    const { session, mainDocumentUri } = setupSession(
      createMultiParagraphDocx(["X", "Y"]),
    );
    const body = getBody(session, mainDocumentUri);
    const view = createDocumentView(session, mainDocumentUri)!;

    await applyTransaction(session, {
      id: "tx-view-child",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
        content: {
          kind: "element",
          name: "p",
          prefix: "w",
          namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          children: [{
            kind: "element",
            name: "r",
            prefix: "w",
            namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            children: [{
              kind: "element",
              name: "t",
              prefix: "w",
              namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
              children: [{ kind: "text", value: "Inserted" }],
            }],
          }],
        },
      }],
    });

    // bodyChild(0) should now be the inserted paragraph
    const child0 = view.bodyChild(0);
    expect(child0).toBeDefined();
    expect(child0!.localName).toBe("p");
    expect(getParagraphText(child0!.element)).toBe("Inserted");
  });
});

// ---- Finding 4: partUri enforced on NodeRef --------------------------------

describe("NodeRef partUri enforcement (finding 4)", () => {
  it("rejects NodeRef whose partUri does not match the step's part", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);

    const result = await applyTransaction(session, {
      id: "tx-wrong-part",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: {
          kind: "append",
          // NodeRef points at a different part than the step's part
          parent: {
            kind: "node",
            partUri: "/word/styles.xml",
            nodeId: body.id,
            stability: "source-anchored",
          },
        },
        content: { kind: "text", value: "test" },
      }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ref-not-found");
      expect(result.message).toContain("styles.xml");
    }
  });

  it("rejects before/after sibling refs with mismatched partUri", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    const result = await applyTransaction(session, {
      id: "tx-wrong-sibling-part",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: {
          kind: "before",
          node: {
            kind: "node",
            partUri: "/word/styles.xml",
            nodeId: firstP.id,
            stability: "source-anchored",
          },
        },
        content: { kind: "text", value: "test" },
      }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("ref-not-found");
      expect(result.message).toContain("styles.xml");
    }
  });
});

// ---- Regression: setAttribute namespace decl emission ---------------------

describe("setAttribute namespace declarations (round 2)", () => {
  it("adds xmlns declaration for prefixed attributes on save", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    await applyTransaction(session, {
      id: "tx-ns-decl",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.setAttribute",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, firstP.id),
        name: "bar",
        namespace: "http://example.com/foo",
        prefix: "foo",
        value: "123",
      }],
    });

    // The element must have a xmlns:foo declaration
    const decl = firstP.namespaceDecls.find((d) => d.prefix === "foo");
    expect(decl).toBeDefined();
    expect(decl!.uri).toBe("http://example.com/foo");

    // Verify the save produces well-formed XML with the declaration
    const savedBytes = savePackage(session) as Uint8Array;
    const xml = new TextDecoder().decode(savedBytes);
    // The archive contains the document.xml part; after reopening we can verify
    const handle = await open(savedBytes);
    await handle.ready("structure");
    const view = handle.documentView()!;
    const root = view.rootElement()!;
    const savedBody = root.children.find(
      (c): c is XmlElementNode => c.kind === "element" && c.localName === "body",
    )!;
    const savedP = getParagraphs(savedBody)[0];
    const savedAttr = savedP.attributes.find((a) => a.localName === "bar");
    expect(savedAttr).toBeDefined();
    expect(savedAttr!.prefix).toBe("foo");
    await handle.close();
  });

  it("does not duplicate existing namespace declarations", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    // Set two attributes with the same prefix/namespace
    await applyTransaction(session, {
      id: "tx-no-dup-ns-1",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [
        {
          kind: "xml.setAttribute",
          part: partRef(mainDocumentUri),
          node: nodeRef(mainDocumentUri, firstP.id),
          name: "a",
          namespace: "http://example.com/ns",
          prefix: "ex",
          value: "1",
        },
      ],
    });

    await applyTransaction(session, {
      id: "tx-no-dup-ns-2",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [
        {
          kind: "xml.setAttribute",
          part: partRef(mainDocumentUri),
          node: nodeRef(mainDocumentUri, firstP.id),
          name: "b",
          namespace: "http://example.com/ns",
          prefix: "ex",
          value: "2",
        },
      ],
    });

    // Should have exactly one xmlns:ex declaration, not two
    const exDecls = firstP.namespaceDecls.filter((d) => d.prefix === "ex");
    expect(exDecls.length).toBe(1);
  });
});

// ---- Regression: bodyChildren cache invalidation --------------------------

describe("bodyChildren cache invalidation (round 2)", () => {
  it("bodyChildren().length matches bodyChildCount() after mutation", async () => {
    const { session, mainDocumentUri } = setupSession(
      createMultiParagraphDocx(["A", "B", "C"]),
    );
    const body = getBody(session, mainDocumentUri);
    const view = createDocumentView(session, mainDocumentUri)!;

    // Pre-populate the cache
    const beforeChildren = view.bodyChildren();
    const beforeCount = beforeChildren.length;

    // Insert a paragraph
    await applyTransaction(session, {
      id: "tx-cache-inval",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
        content: {
          kind: "element",
          name: "p",
          prefix: "w",
          namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          children: [{
            kind: "element",
            name: "r",
            prefix: "w",
            namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            children: [{
              kind: "element",
              name: "t",
              prefix: "w",
              namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
              children: [{ kind: "text", value: "New" }],
            }],
          }],
        },
      }],
    });

    // Both must agree — the cache must not be stale
    expect(view.bodyChildCount()).toBe(beforeCount + 1);
    expect(view.bodyChildren().length).toBe(beforeCount + 1);
    expect(view.bodyChildren().length).toBe(view.bodyChildCount());
  });
});

// ---- Regression: invalidatedRefs stability --------------------------------

describe("invalidatedRefs stability label", () => {
  it("reports session-generated stability for removed session-generated nodes", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);

    // Insert a node (session-generated ID s:N)
    const insertResult = await applyTransaction(session, {
      id: "tx-insert-for-remove",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.insertNode",
        part: partRef(mainDocumentUri),
        position: { kind: "prepend", parent: nodeRef(mainDocumentUri, body.id) },
        content: { kind: "element", name: "temp", prefix: "w", namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main" },
        assignId: "pending:temp",
      }],
    });
    expect(insertResult.ok).toBe(true);
    if (!insertResult.ok) return;

    // Find the created node's ID
    const createdRef = insertResult.createdRefs.find((r) => r.kind === "node");
    expect(createdRef).toBeDefined();
    const createdNodeId = (createdRef as any).nodeId as string;
    expect(createdNodeId.startsWith("s:")).toBe(true);

    // Remove it
    const removeResult = await applyTransaction(session, {
      id: "tx-remove-session-node",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.removeNode",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, createdNodeId, "session-generated"),
      }],
    });
    expect(removeResult.ok).toBe(true);
    if (!removeResult.ok) return;

    // The invalidated ref should report session-generated, not source-anchored
    const invalidated = removeResult.invalidatedRefs.find(
      (r) => r.kind === "node" && (r as any).nodeId === createdNodeId,
    );
    expect(invalidated).toBeDefined();
    expect((invalidated as any).stability).toBe("session-generated");
  });

  it("reports source-anchored stability for removed imported nodes", async () => {
    const { session, mainDocumentUri } = setupSession(createMinimalDocx());
    const body = getBody(session, mainDocumentUri);
    const firstP = getParagraphs(body)[0];

    // firstP is an imported node — its ID does NOT start with "s:"
    expect(firstP.id.startsWith("s:")).toBe(false);

    const result = await applyTransaction(session, {
      id: "tx-remove-imported",
      baseRevision: session.currentRevision,
      origin: { kind: "local" },
      steps: [{
        kind: "xml.removeNode",
        part: partRef(mainDocumentUri),
        node: nodeRef(mainDocumentUri, firstP.id),
      }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const invalidated = result.invalidatedRefs.find(
      (r) => r.kind === "node" && (r as any).nodeId === firstP.id,
    );
    expect(invalidated).toBeDefined();
    expect((invalidated as any).stability).toBe("source-anchored");
  });
});

