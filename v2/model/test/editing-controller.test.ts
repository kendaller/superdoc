// ---------------------------------------------------------------------------
// V2 Editing Controller Integration Tests
//
// Tests the editing controller against real v2/model sessions.
// Verifies: init, apply op, undo/redo, doc-api invoke, save.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';
import { createSession, advanceToStage } from '../src/session/session.js';
import { createHandle } from '../src/session/handle.js';
import { resolvePartBytes } from '../src/session/part-bytes.js';
import {
  applySemanticOperation,
  resetOperationCounter,
  SemanticHistory,
  DocumentApiAdapter,
  SemanticModel,
} from '../src/operations/index.js';
import { createMinimalDocx } from './helpers/create-test-docx.js';
import type { SemanticOperation } from '../src/operations/types.js';

/**
 * Test-only controller that mirrors V2EditingController's core behavior
 * but operates directly on model internals for integration testing.
 *
 * The real V2EditingController lives in super-editor and requires
 * V2DocumentRuntime. This test controller validates the model-level
 * contract that the real controller depends on.
 */
class TestEditingController {
  private model: SemanticModel;
  private history = new SemanticHistory();
  private changedCount = 0;

  constructor(model: SemanticModel) {
    this.model = model;
  }

  get session() {
    return this.model.session;
  }
  get revision() {
    return this.model.session.currentRevision;
  }
  get isDirty() {
    return this.history.undoDepth() > 0;
  }
  get changeCount() {
    return this.changedCount;
  }
  get canUndo() {
    return this.history.canUndo();
  }
  get canRedo() {
    return this.history.canRedo();
  }

  async applyOperation(op: SemanticOperation) {
    const result = await applySemanticOperation(op, this.model, this.session, this.history);
    if (result.ok) this.changedCount++;
    return result;
  }

  async invoke(operationKey: string, args: Record<string, unknown>) {
    const adapter = new DocumentApiAdapter(this.model);
    const semanticOp = adapter.translate(operationKey, args);
    if (!semanticOp) return { unsupported: true, operationKey };
    return this.applyOperation(semanticOp);
  }

  async undo() {
    const reverseOp = this.history.undo();
    if (!reverseOp) return { noop: true, reason: 'Nothing to undo' };
    const result = await applySemanticOperation(reverseOp, this.model, this.session);
    if (result.ok) this.changedCount++;
    return result;
  }

  async redo() {
    const forwardOp = this.history.redo();
    if (!forwardOp) return { noop: true, reason: 'Nothing to redo' };
    const result = await applySemanticOperation(forwardOp, this.model, this.session);
    if (result.ok) this.changedCount++;
    return result;
  }

  supportedOperations() {
    return new DocumentApiAdapter(this.model).supportedOperations();
  }
}

async function createController(text = 'Hello, World!') {
  const bytes = createMinimalDocx(text);
  const session = createSession({ kind: 'memory', bytes });
  await advanceToStage(session, 'structure');
  const handle = createHandle(session);
  const model = handle.semanticModel();
  if (!model) throw new Error('No semantic model');
  return { controller: new TestEditingController(model), model, session, handle };
}

function readDocumentXml(session: ReturnType<typeof createSession>): string {
  const documentPart = session.parts.get('/word/document.xml');
  if (!documentPart || documentPart.kind !== 'xml') throw new Error('Missing doc part');
  return new TextDecoder().decode(resolvePartBytes(documentPart, session));
}

describe('V2EditingController (integration)', () => {
  beforeEach(() => {
    resetOperationCounter();
  });

  describe('initialization', () => {
    it('starts with a clean revision', async () => {
      const { controller } = await createController();
      expect(controller.revision).toBeTruthy();
      expect(controller.isDirty).toBe(false);
    });

    it('reports supported operations', async () => {
      const { controller } = await createController();
      const ops = controller.supportedOperations();
      expect(ops).toContain('paragraph.insertText');
      expect(ops).toContain('run.toggleBold');
      expect(ops).toHaveLength(6);
    });
  });

  describe('mutation execution', () => {
    it('applies a semantic operation', async () => {
      const { controller, model, session } = await createController('Hello');
      const para = model.blockEntities(model.mainStory()!.ref)[0];
      const run = model.runs(para.ref)[0];

      const result = await controller.applyOperation({
        id: 'test-1',
        label: 'Insert',
        kind: 'insertText',
        target: run.ref,
        text: '!',
        position: { segmentIndex: 0, charOffset: 5 },
      });

      expect(result.ok).toBe(true);
      expect(readDocumentXml(session)).toContain('Hello!');
      expect(controller.isDirty).toBe(true);
      expect(controller.changeCount).toBe(1);
    });

    it('advances revision after mutation', async () => {
      const { controller, model } = await createController('Hello');
      const initialRevision = controller.revision;
      const para = model.blockEntities(model.mainStory()!.ref)[0];
      const run = model.runs(para.ref)[0];

      await controller.applyOperation({
        id: 'test-2',
        label: 'Insert',
        kind: 'insertText',
        target: run.ref,
        text: ' world',
      });

      expect(controller.revision).not.toBe(initialRevision);
    });
  });

  describe('undo / redo', () => {
    it('can undo a mutation', async () => {
      const { controller, model, session } = await createController('Hello');
      const para = model.blockEntities(model.mainStory()!.ref)[0];
      const run = model.runs(para.ref)[0];

      await controller.applyOperation({
        id: 'test-3',
        label: 'Insert',
        kind: 'insertText',
        target: run.ref,
        text: '!',
        position: { segmentIndex: 0, charOffset: 5 },
      });

      expect(readDocumentXml(session)).toContain('Hello!');
      expect(controller.canUndo).toBe(true);

      await controller.undo();
      expect(readDocumentXml(session)).toContain('Hello');
      expect(readDocumentXml(session)).not.toContain('Hello!');
    });

    it('can redo after undo', async () => {
      const { controller, model, session } = await createController('Hello');
      const para = model.blockEntities(model.mainStory()!.ref)[0];
      const run = model.runs(para.ref)[0];

      await controller.applyOperation({
        id: 'test-4',
        label: 'Insert',
        kind: 'insertText',
        target: run.ref,
        text: '!',
        position: { segmentIndex: 0, charOffset: 5 },
      });

      await controller.undo();
      expect(controller.canRedo).toBe(true);

      await controller.redo();
      expect(readDocumentXml(session)).toContain('Hello!');
    });

    it('returns noop when nothing to undo', async () => {
      const { controller } = await createController('Hello');
      const result = await controller.undo();
      expect('noop' in result && result.noop).toBe(true);
    });
  });

  describe('document-api invocation', () => {
    it('invokes paragraph.insertText', async () => {
      const { controller, model, session } = await createController('Hello');
      const para = model.blockEntities(model.mainStory()!.ref)[0];
      const run = model.runs(para.ref)[0];

      const result = await controller.invoke('paragraph.insertText', {
        targetRef: run.ref.id,
        text: ' world',
      });

      expect('ok' in result && result.ok).toBe(true);
      expect(readDocumentXml(session)).toContain('Hello world');
    });

    it('returns unsupported for unknown operations', async () => {
      const { controller } = await createController();
      const result = await controller.invoke('unknown.operation', {});
      expect('unsupported' in result && result.unsupported).toBe(true);
    });
  });

  describe('model session accessor', () => {
    it('SemanticModel exposes session for controller use', async () => {
      const { model, session } = await createController();
      expect(model.session).toBe(session);
      expect(model.session.currentRevision).toBeTruthy();
    });
  });
});
