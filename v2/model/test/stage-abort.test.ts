// ---------------------------------------------------------------------------
// Ready-stage abort tests
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { advanceToStage, createSession } from '../src/session/session.js';
import { createComplexDocx } from './helpers/create-test-docx.js';

describe('ready-stage aborts', () => {
  it('honors an aborted signal before structure indexing begins', async () => {
    const session = createSession({
      kind: 'memory',
      bytes: createComplexDocx(),
    });

    await advanceToStage(session, 'render-shell');

    const controller = new AbortController();
    controller.abort();

    await expect(advanceToStage(session, 'structure', controller.signal)).rejects.toThrow('Aborted');

    expect(session.currentStage).toBe('render-shell');
  });
});
