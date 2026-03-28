// ---------------------------------------------------------------------------
// Render-shell stage tests
//
// Proves that:
// 1. "render-shell" is a valid and distinct ready stage
// 2. Body-child windows work without full structure
// 3. semanticModel() is unavailable before "structure"
// 4. Page geometry is available at render-shell
// 5. Comments and secondary stories are not required
// 6. Fewer parts are indexed at render-shell than at structure
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { open } from '../src/session/open.js';
import { createRenderShellSnapshot } from '../src/render-shell/render-shell-snapshot.js';
import { createMinimalDocx, createMultiParagraphDocx, createComplexDocx } from './helpers/create-test-docx.js';

describe('render-shell stage', () => {
  it('is a valid ready stage distinct from fast-open and structure', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    const status = await handle.status();
    expect(status.currentStage).toBe('render-shell');

    await handle.close();
  });

  it('advances through render-shell on the way to structure', async () => {
    const handle = await open(createMinimalDocx());

    // Before advancing, we're at fast-open
    const before = await handle.status();
    expect(before.currentStage).toBe('fast-open');

    // Advance directly to structure — should pass through render-shell
    await handle.ready('structure');

    const after = await handle.status();
    expect(after.currentStage).toBe('structure');

    await handle.close();
  });

  it('is idempotent — calling render-shell twice does not error', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');
    await handle.ready('render-shell');

    const status = await handle.status();
    expect(status.currentStage).toBe('render-shell');

    await handle.close();
  });

  it('can advance from render-shell to structure', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');
    expect((await handle.status()).currentStage).toBe('render-shell');

    await handle.ready('structure');
    expect((await handle.status()).currentStage).toBe('structure');

    await handle.close();
  });
});

describe('renderShell() accessor', () => {
  it('returns undefined before render-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    expect(handle.renderShell()).toBeUndefined();
    await handle.close();
  });

  it('returns RenderShellDocument after render-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    const shell = handle.renderShell();
    expect(shell).toBeDefined();

    await handle.close();
  });

  it('is also available at structure stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('structure');

    const shell = handle.renderShell();
    expect(shell).toBeDefined();

    await handle.close();
  });
});

describe('render-shell body-child access', () => {
  it('reports body child count without full structure', async () => {
    const paragraphs = ['One', 'Two', 'Three', 'Four', 'Five'];
    const handle = await open(createMultiParagraphDocx(paragraphs));
    await handle.ready('render-shell');

    const shell = handle.renderShell()!;
    // 5 paragraphs + 1 sectPr = 6 body children
    expect(shell.bodyChildCount()).toBe(6);

    await handle.close();
  });

  it('returns windowed body children', async () => {
    const paragraphs = ['A', 'B', 'C', 'D', 'E'];
    const handle = await open(createMultiParagraphDocx(paragraphs));
    await handle.ready('render-shell');

    const shell = handle.renderShell()!;
    const window = shell.bodyChildWindow(1, 3);

    expect(window).toHaveLength(3);
    expect(window[0].index).toBe(1);
    expect(window[1].index).toBe(2);
    expect(window[2].index).toBe(3);
    expect(window[0].localName).toBe('p');

    await handle.close();
  });

  it('clamps window to available children', async () => {
    const handle = await open(createMultiParagraphDocx(['A', 'B']));
    await handle.ready('render-shell');

    const shell = handle.renderShell()!;
    // Request more than available
    const window = shell.bodyChildWindow(0, 100);

    // 2 paragraphs + 1 sectPr = 3
    expect(window).toHaveLength(3);

    await handle.close();
  });

  it('returns empty for out-of-range start', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    const shell = handle.renderShell()!;
    const window = shell.bodyChildWindow(999, 5);
    expect(window).toHaveLength(0);

    await handle.close();
  });
});

describe('render-shell page geometry', () => {
  it('provides primary page geometry at render-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    const shell = handle.renderShell()!;
    const geo = shell.primaryPageGeometry();

    expect(geo).toBeDefined();
    expect(geo!.width).toBe(12240);
    expect(geo!.height).toBe(15840);
    expect(geo!.margins.top).toBe(1440);
    expect(geo!.margins.right).toBe(1440);
    expect(geo!.margins.bottom).toBe(1440);
    expect(geo!.margins.left).toBe(1440);

    await handle.close();
  });

  it('enumerates section shells', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    const shell = handle.renderShell()!;
    const sections = shell.sectionShells();

    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].pageGeometry).toBeDefined();
    expect(sections[0].pageGeometry.width).toBe(12240);

    await handle.close();
  });
});

describe('render-shell snapshot transport', () => {
  it('keeps the default snapshot cheap by omitting full section shells', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    const snapshot = createRenderShellSnapshot(handle.renderShell());

    expect(snapshot).toBeDefined();
    expect(snapshot?.bodyChildCount).toBeGreaterThan(0);
    expect(snapshot?.sections).toEqual([]);
    expect(snapshot?.primaryPageGeometry?.width).toBe(12240);

    await handle.close();
  });

  it('can opt into section shells for non-critical callers', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    const snapshot = createRenderShellSnapshot(handle.renderShell(), { includeSections: true });

    expect(snapshot).toBeDefined();
    expect(snapshot?.sections.length).toBeGreaterThan(0);
    expect(snapshot?.sections[0].pageGeometry.width).toBe(12240);

    await handle.close();
  });
});

describe('render-shell style/numbering/settings access', () => {
  it('provides style shell at render-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    const shell = handle.renderShell()!;
    const styles = shell.styleShell();

    expect(styles).toBeDefined();
    expect(styles!.list().length).toBeGreaterThan(0);

    await handle.close();
  });

  it('provides numbering shell at render-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    const shell = handle.renderShell()!;
    const numbering = shell.numberingShell();

    expect(numbering).toBeDefined();

    await handle.close();
  });

  it('provides settings shell at render-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    const shell = handle.renderShell()!;
    const settings = shell.settingsShell();

    expect(settings).toBeDefined();

    await handle.close();
  });
});

describe('render-shell guards', () => {
  it('semanticModel() is unavailable at render-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    expect(handle.semanticModel()).toBeUndefined();

    await handle.close();
  });

  it('semanticModel() becomes available at structure stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('structure');

    expect(handle.semanticModel()).toBeDefined();

    await handle.close();
  });
});

describe('render-shell indexes fewer parts than structure', () => {
  it('indexes fewer XML parts at render-shell than at structure', async () => {
    const handle = await open(createComplexDocx());
    await handle.ready('render-shell');

    const renderShellStatus = await handle.status();
    const renderShellIndexed = renderShellStatus.metrics.indexedXmlPartCount;

    await handle.ready('structure');

    const structureStatus = await handle.status();
    const structureIndexed = structureStatus.metrics.indexedXmlPartCount;

    expect(renderShellIndexed).toBeGreaterThan(0);
    expect(structureIndexed).toBeGreaterThan(renderShellIndexed);

    await handle.close();
  });

  it('does not require comments to be indexed for render-shell', async () => {
    const handle = await open(createComplexDocx());
    await handle.ready('render-shell');

    // render-shell should work fine even though the complex docx has comments
    const shell = handle.renderShell()!;
    expect(shell.bodyChildCount()).toBeGreaterThan(0);
    expect(shell.primaryPageGeometry()).toBeDefined();

    await handle.close();
  });
});
