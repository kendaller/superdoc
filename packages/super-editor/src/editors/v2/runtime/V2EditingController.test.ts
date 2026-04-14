import { describe, expect, it } from 'vitest';
import type { SemanticModel } from '@superdoc/v2-model';
import { V2EditingController } from './V2EditingController.js';
import { createMinimalDocx } from '../../../../../../v2/model/test/helpers/create-test-docx.js';

function getFirstRun(model: SemanticModel) {
  const mainStory = model.mainStory();
  if (!mainStory) {
    throw new Error('Missing main story');
  }

  const paragraph = model.blockEntities(mainStory.ref)[0];
  if (!paragraph || paragraph.kind !== 'paragraph') {
    throw new Error('Missing first paragraph');
  }

  const run = model.runs(paragraph.ref)[0];
  if (!run) {
    throw new Error('Missing first run');
  }

  return run.ref;
}

describe('V2EditingController', () => {
  it('clears history when reinitialized with a new document', async () => {
    const controller = new V2EditingController();

    await controller.initialize(createMinimalDocx('Hello'));

    const firstModel = controller.semanticModel;
    expect(firstModel).not.toBeNull();
    const firstRunRef = getFirstRun(firstModel!);

    const firstResult = await controller.applyOperation({
      id: 'controller-test-1',
      label: 'Insert text',
      kind: 'insertText',
      target: firstRunRef,
      text: ' world',
      position: { segmentIndex: 0, charOffset: 5 },
    });

    expect(firstResult.ok).toBe(true);
    expect(controller.isDirty).toBe(true);
    expect(controller.canUndo).toBe(true);

    await controller.initialize(createMinimalDocx('Fresh'));

    expect(controller.isDirty).toBe(false);
    expect(controller.canUndo).toBe(false);
    expect(controller.canRedo).toBe(false);

    await controller.close();
  });

  it('resets dirty state after save and tracks later edits again', async () => {
    const controller = new V2EditingController();

    await controller.initialize(createMinimalDocx('Hello'));

    const model = controller.semanticModel;
    expect(model).not.toBeNull();
    const runRef = getFirstRun(model!);

    const firstResult = await controller.applyOperation({
      id: 'controller-test-2',
      label: 'Insert exclamation',
      kind: 'insertText',
      target: runRef,
      text: '!',
      position: { segmentIndex: 0, charOffset: 5 },
    });

    expect(firstResult.ok).toBe(true);
    expect(controller.isDirty).toBe(true);

    const saveResult = await controller.save({ target: 'bytes' });
    expect(saveResult).toBeInstanceOf(Uint8Array);
    expect(controller.isDirty).toBe(false);

    const secondResult = await controller.applyOperation({
      id: 'controller-test-3',
      label: 'Insert again',
      kind: 'insertText',
      target: runRef,
      text: '?',
      position: { segmentIndex: 0, charOffset: 6 },
    });

    expect(secondResult.ok).toBe(true);
    expect(controller.isDirty).toBe(true);

    await controller.close();
  });
});
