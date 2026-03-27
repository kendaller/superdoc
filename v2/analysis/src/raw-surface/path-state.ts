// ---------------------------------------------------------------------------
// Path State
// ---------------------------------------------------------------------------
// Maintains the current position in the XML tree during SAX traversal.
// Produces both the stable pathSignature (unindexed, for grouping) and
// the exact xpathLikePath (indexed, for evidence).
// ---------------------------------------------------------------------------

import type { QualifiedName, MarkupCompatibilityContext } from './types.js';
import { formatQName } from './namespace-format.js';

type StackFrame = {
  formattedName: string;
  siblingIndex: number;
  childElementCounts: Map<string, number>;
  auxiliaryCounts: Map<string, number>;
  mcContext: MarkupCompatibilityContext;
};

const MC_NAMESPACE = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

export class PathState {
  private stack: StackFrame[] = [];
  private rootElementCounts = new Map<string, number>();
  private rootAuxiliaryCounts = new Map<string, number>();
  private partUri: string;

  constructor(partUri: string) {
    this.partUri = partUri;
  }

  /** Push an element onto the path stack. Returns the formatted element name. */
  pushElement(qname: QualifiedName): string {
    const formattedName = formatQName(qname);
    const parent = this.currentFrame();

    // Track sibling index at parent level
    const siblingCounts = parent?.childElementCounts ?? this.rootElementCounts;
    const siblingIndex = (siblingCounts.get(formattedName) ?? 0) + 1;
    siblingCounts.set(formattedName, siblingIndex);

    // Determine markup compatibility context
    const mcContext = this.resolveMcContext(qname, parent?.mcContext);

    this.stack.push({
      formattedName,
      siblingIndex,
      childElementCounts: new Map(),
      auxiliaryCounts: new Map(),
      mcContext,
    });

    return formattedName;
  }

  /** Pop the current element from the stack. */
  popElement(): void {
    this.stack.pop();
  }

  /** Get the unindexed path signature for the current position. */
  getPathSignature(): string {
    const segments = this.stack.map((f) => f.formattedName);
    return `${this.partUri}::/${segments.join('/')}`;
  }

  /** Get the indexed xpath-like path for the current position. */
  getXpathLikePath(): string {
    const segments = this.stack.map((f) => `${f.formattedName}[${f.siblingIndex}]`);
    return `${this.partUri}::/${segments.join('/')}`;
  }

  /** Get path signature with an attribute suffix. */
  getAttributePathSignature(attrName: string): string {
    return `${this.getPathSignature()}@${attrName}`;
  }

  /** Get xpath-like path with an attribute suffix. */
  getAttributeXpathLikePath(attrName: string): string {
    return `${this.getXpathLikePath()}/@${attrName}`;
  }

  /** Get the path signature of the parent element, if any. */
  getParentPathSignature(): string | undefined {
    if (this.stack.length < 2) return undefined;
    const parentSegments = this.stack.slice(0, -1).map((f) => f.formattedName);
    return `${this.partUri}::/${parentSegments.join('/')}`;
  }

  /** Get the current markup compatibility context. */
  getMcContext(): MarkupCompatibilityContext {
    return this.currentFrame()?.mcContext ?? { branch: null, alternateContentDepth: 0 };
  }

  /** Get the next same-target sibling index for a processing instruction. */
  nextProcessingInstructionIndex(target: string): number {
    return this.incrementAuxiliaryCount(`processing-instruction(${target})`);
  }

  /** Get the next sibling index for a comment node. */
  nextCommentIndex(): number {
    return this.incrementAuxiliaryCount('comment()');
  }

  private currentFrame(): StackFrame | undefined {
    return this.stack[this.stack.length - 1];
  }

  private incrementAuxiliaryCount(key: string): number {
    const counts = this.currentFrame()?.auxiliaryCounts ?? this.rootAuxiliaryCounts;
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    return next;
  }

  private resolveMcContext(
    qname: QualifiedName,
    parentMc: MarkupCompatibilityContext | undefined,
  ): MarkupCompatibilityContext {
    const base = parentMc ?? { branch: null, alternateContentDepth: 0 };
    const isMcNamespace = qname.namespaceUri === MC_NAMESPACE;

    if (isMcNamespace && qname.localName === 'AlternateContent') {
      return { branch: null, alternateContentDepth: base.alternateContentDepth + 1 };
    }

    if (isMcNamespace && qname.localName === 'Choice') {
      return { branch: 'choice', alternateContentDepth: base.alternateContentDepth };
    }

    if (isMcNamespace && qname.localName === 'Fallback') {
      return { branch: 'fallback', alternateContentDepth: base.alternateContentDepth };
    }

    return base;
  }
}
