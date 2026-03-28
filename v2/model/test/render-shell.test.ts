// ---------------------------------------------------------------------------
// Render-shell stage tests
//
// Proves that:
// 1. "first-paint-shell" and "render-shell" are valid ready stages
// 2. Body-child windows work without full structure
// 3. semanticModel() is unavailable before "structure"
// 4. Page geometry is available at first-paint-shell
// 5. Comments and secondary stories are not required
// 6. Support shells remain deferred until render-shell
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { open } from '../src/session/open.js';
import { createRenderShellSnapshot } from '../src/render-shell/render-shell-snapshot.js';
import { createComplexDocx, createMinimalDocx, createMultiParagraphDocx } from './helpers/create-test-docx.js';

describe('render-shell stages', () => {
  it('treats first-paint-shell as a valid intermediate stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('first-paint-shell');

    expect((await handle.status()).currentStage).toBe('first-paint-shell');

    await handle.close();
  });

  it('advances through both shell stages on the way to structure', async () => {
    const handle = await open(createMinimalDocx());

    expect((await handle.status()).currentStage).toBe('fast-open');

    await handle.ready('structure');

    expect((await handle.status()).currentStage).toBe('structure');

    await handle.close();
  });

  it('is idempotent for first-paint-shell', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('first-paint-shell');
    await handle.ready('first-paint-shell');

    expect((await handle.status()).currentStage).toBe('first-paint-shell');

    await handle.close();
  });

  it('can advance from first-paint-shell to render-shell to structure', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('first-paint-shell');
    expect((await handle.status()).currentStage).toBe('first-paint-shell');

    await handle.ready('render-shell');
    expect((await handle.status()).currentStage).toBe('render-shell');

    await handle.ready('structure');
    expect((await handle.status()).currentStage).toBe('structure');

    await handle.close();
  });
});

describe('renderShell() accessor', () => {
  it('returns undefined before first-paint-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    expect(handle.renderShell()).toBeUndefined();
    await handle.close();
  });

  it('returns RenderShellDocument after first-paint-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('first-paint-shell');

    expect(handle.renderShell()).toBeDefined();

    await handle.close();
  });

  it('is also available at structure stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('structure');

    expect(handle.renderShell()).toBeDefined();

    await handle.close();
  });
});

describe('render-shell body-child access', () => {
  it('reports body child count without full structure', async () => {
    const paragraphs = ['One', 'Two', 'Three', 'Four', 'Five'];
    const handle = await open(createMultiParagraphDocx(paragraphs));
    await handle.ready('first-paint-shell');

    const shell = handle.renderShell()!;
    expect(shell.bodyChildCount()).toBe(6);

    await handle.close();
  });

  it('returns windowed body children', async () => {
    const paragraphs = ['A', 'B', 'C', 'D', 'E'];
    const handle = await open(createMultiParagraphDocx(paragraphs));
    await handle.ready('first-paint-shell');

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
    await handle.ready('first-paint-shell');

    const shell = handle.renderShell()!;
    const window = shell.bodyChildWindow(0, 100);

    expect(window).toHaveLength(3);

    await handle.close();
  });

  it('returns empty for out-of-range start', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('first-paint-shell');

    const shell = handle.renderShell()!;
    expect(shell.bodyChildWindow(999, 5)).toHaveLength(0);

    await handle.close();
  });
});

describe('render-shell page geometry', () => {
  it('provides primary page geometry at first-paint-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('first-paint-shell');

    const geo = handle.renderShell()!.primaryPageGeometry();

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
    await handle.ready('first-paint-shell');

    const sections = handle.renderShell()!.sectionShells();

    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].pageGeometry.width).toBe(12240);

    await handle.close();
  });
});

describe('render-shell snapshot transport', () => {
  it('keeps the default snapshot cheap at first-paint-shell', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('first-paint-shell');

    const snapshot = createRenderShellSnapshot(handle.renderShell());

    expect(snapshot).toBeDefined();
    expect(snapshot?.bodyChildCount).toBeGreaterThan(0);
    expect(snapshot?.sections).toEqual([]);
    expect(snapshot?.primaryPageGeometry?.width).toBe(12240);
    expect(snapshot?.availableShells).toEqual({
      styles: false,
      numbering: false,
      settings: false,
    });

    await handle.close();
  });

  it('reports support-shell availability after render-shell', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    const snapshot = createRenderShellSnapshot(handle.renderShell());

    expect(snapshot).toBeDefined();
    expect(snapshot?.availableShells).toEqual({
      styles: true,
      numbering: true,
      settings: true,
    });

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
  it('keeps support shells deferred at first-paint-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('first-paint-shell');

    const shell = handle.renderShell()!;

    expect(shell.styleShell()).toBeUndefined();
    expect(shell.numberingShell()).toBeUndefined();
    expect(shell.settingsShell()).toBeUndefined();

    await handle.close();
  });

  it('provides style shell at render-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    const styles = handle.renderShell()!.styleShell();

    expect(styles).toBeDefined();
    expect(styles!.list().length).toBeGreaterThan(0);

    await handle.close();
  });

  it('provides numbering shell at render-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    expect(handle.renderShell()!.numberingShell()).toBeDefined();

    await handle.close();
  });

  it('provides settings shell at render-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('render-shell');

    expect(handle.renderShell()!.settingsShell()).toBeDefined();

    await handle.close();
  });
});

describe('render-shell guards', () => {
  it('semanticModel() is unavailable at first-paint-shell stage', async () => {
    const handle = await open(createMinimalDocx());
    await handle.ready('first-paint-shell');

    expect(handle.semanticModel()).toBeUndefined();

    await handle.close();
  });

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

describe('render-shell indexing', () => {
  it('indexes fewer XML parts at first-paint-shell than at render-shell', async () => {
    const handle = await open(createComplexDocx());
    await handle.ready('first-paint-shell');
    const firstPaintIndexed = (await handle.status()).metrics.indexedXmlPartCount;

    await handle.ready('render-shell');
    const renderShellIndexed = (await handle.status()).metrics.indexedXmlPartCount;

    expect(firstPaintIndexed).toBeGreaterThan(0);
    expect(renderShellIndexed).toBeGreaterThan(firstPaintIndexed);

    await handle.close();
  });

  it('indexes fewer XML parts at render-shell than at structure', async () => {
    const handle = await open(createComplexDocx());
    await handle.ready('render-shell');
    const renderShellIndexed = (await handle.status()).metrics.indexedXmlPartCount;

    await handle.ready('structure');
    const structureIndexed = (await handle.status()).metrics.indexedXmlPartCount;

    expect(structureIndexed).toBeGreaterThan(renderShellIndexed);

    await handle.close();
  });

  it('does not require comments to be indexed for first-paint-shell', async () => {
    const handle = await open(createComplexDocx());
    await handle.ready('first-paint-shell');

    const shell = handle.renderShell()!;
    expect(shell.bodyChildCount()).toBeGreaterThan(0);
    expect(shell.primaryPageGeometry()).toBeDefined();

    await handle.close();
  });
});
