import { describe, expect, it, beforeEach } from 'vitest';
import { compileParagraphEdit, resetCompilerOpCounter, type CompileInput } from './V2ParagraphEditCompiler.js';

function makeInput(overrides: Partial<CompileInput>): CompileInput {
  return {
    paragraphRef: { id: 'para-1' },
    runRef: { id: 'run-1' },
    originalText: 'Hello',
    editedText: 'Hello',
    ...overrides,
  };
}

describe('V2ParagraphEditCompiler', () => {
  beforeEach(() => {
    resetCompilerOpCounter();
  });

  it('returns no operations when text is unchanged', () => {
    const result = compileParagraphEdit(makeInput({ originalText: 'Hello', editedText: 'Hello' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations).toHaveLength(0);
    }
  });

  it('compiles a simple text insertion', () => {
    const result = compileParagraphEdit(makeInput({ originalText: 'Hello', editedText: 'Hello!' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations).toHaveLength(1);
      const op = result.operations[0];
      expect(op.kind).toBe('insertText');
      if (op.kind === 'insertText') {
        expect(op.text).toBe('!');
        expect(op.position).toEqual({ segmentIndex: 0, charOffset: 5 });
        expect(op.deleteLength).toBeUndefined();
      }
    }
  });

  it('compiles a text insertion in the middle', () => {
    const result = compileParagraphEdit(makeInput({ originalText: 'Hello world', editedText: 'Hello big world' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations).toHaveLength(1);
      const op = result.operations[0];
      expect(op.kind).toBe('insertText');
      if (op.kind === 'insertText') {
        expect(op.text).toBe('big ');
        expect(op.position).toEqual({ segmentIndex: 0, charOffset: 6 });
      }
    }
  });

  it('compiles a pure text deletion', () => {
    const result = compileParagraphEdit(makeInput({ originalText: 'Hello!', editedText: 'Hello' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations).toHaveLength(1);
      const op = result.operations[0];
      expect(op.kind).toBe('insertText');
      if (op.kind === 'insertText') {
        expect(op.text).toBe('');
        expect(op.deleteLength).toBe(1);
        expect(op.position).toEqual({ segmentIndex: 0, charOffset: 5 });
      }
    }
  });

  it('compiles a text replacement', () => {
    const result = compileParagraphEdit(makeInput({ originalText: 'Hello world', editedText: 'Hello earth' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations).toHaveLength(1);
      const op = result.operations[0];
      expect(op.kind).toBe('insertText');
      if (op.kind === 'insertText') {
        expect(op.text).toBe('earth');
        expect(op.deleteLength).toBe(5);
        expect(op.position).toEqual({ segmentIndex: 0, charOffset: 6 });
      }
    }
  });

  it('compiles a paragraph split', () => {
    const result = compileParagraphEdit(makeInput({ originalText: 'Hello world', editedText: 'Hello\n world' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations).toHaveLength(1);
      const op = result.operations[0];
      expect(op.kind).toBe('splitParagraph');
      if (op.kind === 'splitParagraph') {
        expect(op.target.id).toBe('para-1');
        expect(op.at.charOffset).toBe(5);
      }
    }
  });

  it('rejects multiple paragraph splits', () => {
    const result = compileParagraphEdit(makeInput({ originalText: 'abc', editedText: 'a\nb\nc' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Multiple paragraph splits');
    }
  });

  it('rejects paragraph splits that also change text', () => {
    const result = compileParagraphEdit(makeInput({ originalText: 'Hello world', editedText: 'Hello\nthere' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('additional text changes');
    }
  });

  it('assigns sequential operation IDs', () => {
    const result1 = compileParagraphEdit(makeInput({ originalText: 'a', editedText: 'ab' }));
    const result2 = compileParagraphEdit(makeInput({ originalText: 'a', editedText: 'ac' }));

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (result1.ok && result2.ok) {
      expect(result1.operations[0].id).toBe('overlay-edit:1');
      expect(result2.operations[0].id).toBe('overlay-edit:2');
    }
  });

  it('compiles deletion of all text to empty', () => {
    const result = compileParagraphEdit(makeInput({ originalText: 'Hello', editedText: '' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations).toHaveLength(1);
      const op = result.operations[0];
      expect(op.kind).toBe('insertText');
      if (op.kind === 'insertText') {
        expect(op.text).toBe('');
        expect(op.deleteLength).toBe(5);
        expect(op.position).toEqual({ segmentIndex: 0, charOffset: 0 });
      }
    }
  });

  it('compiles insertion into empty text', () => {
    const result = compileParagraphEdit(makeInput({ originalText: '', editedText: 'New text' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations).toHaveLength(1);
      const op = result.operations[0];
      expect(op.kind).toBe('insertText');
      if (op.kind === 'insertText') {
        expect(op.text).toBe('New text');
        expect(op.position).toEqual({ segmentIndex: 0, charOffset: 0 });
      }
    }
  });
});
