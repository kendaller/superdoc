const NODE_FEATURES = new Map<
  string,
  {
    featureKey: string;
    runtimeNodeTypes?: string[];
  }
>([
  ['w:p', { featureKey: 'paragraph', runtimeNodeTypes: ['paragraph'] }],
  ['w:r', { featureKey: 'run', runtimeNodeTypes: ['run'] }],
  ['w:tbl', { featureKey: 'table', runtimeNodeTypes: ['table'] }],
  ['w:tr', { featureKey: 'table.row', runtimeNodeTypes: ['tableRow'] }],
  ['w:tc', { featureKey: 'table.cell', runtimeNodeTypes: ['tableCell'] }],
  ['w:tab', { featureKey: 'inline.tab', runtimeNodeTypes: ['tab'] }],
  ['w:br', { featureKey: 'inline.break', runtimeNodeTypes: ['lineBreak'] }],
  ['w:footnoteReference', { featureKey: 'footnote.reference', runtimeNodeTypes: ['footnoteReference'] }],
  ['w:endnoteReference', { featureKey: 'endnote.reference', runtimeNodeTypes: ['endnoteReference'] }],
  ['w:commentRangeStart', { featureKey: 'comment.range-start', runtimeNodeTypes: ['commentRangeStart'] }],
]);

const PROPERTY_FEATURES = new Map<string, string>([
  ['w:b', 'format.bold.direct'],
  ['w:i', 'format.italic.direct'],
  ['w:u', 'format.underline.direct'],
  ['w:sz', 'format.font-size.direct'],
  ['w:color', 'format.color.direct'],
  ['w:pStyle', 'style-reference.paragraph'],
  ['w:rStyle', 'style-reference.character'],
  ['w:tblStyle', 'style-reference.table'],
  ['w:numPr', 'numbering-reference'],
]);

type RuntimeNode = {
  type?: unknown;
  attrs?: {
    isAnchor?: unknown;
  };
};

function asRuntimeNodes(encodedResult: unknown): RuntimeNode[] {
  if (Array.isArray(encodedResult)) {
    return encodedResult.filter((value): value is RuntimeNode => Boolean(value && typeof value === 'object'));
  }

  if (encodedResult && typeof encodedResult === 'object') {
    return [encodedResult as RuntimeNode];
  }

  return [];
}

export function getFeatureBindingForNodeTranslation(
  xmlName: string,
  xmlNode: { elements?: Array<{ name?: string }> } | null | undefined,
  encodedResult: unknown,
): { featureKey: string; runtimeNodes: object[]; sourceNode?: object } | null {
  if (xmlName === 'w:drawing') {
    const runtimeNodes = asRuntimeNodes(encodedResult);
    const firstNode = runtimeNodes[0];
    if (!firstNode) return null;
    const sourceNode =
      xmlNode?.elements?.find((element) => element?.name === 'wp:anchor') ??
      xmlNode?.elements?.find((element) => element?.name === 'wp:inline');
    if (!sourceNode) return null;

    return {
      featureKey: (sourceNode as { name?: string }).name === 'wp:anchor' ? 'drawing.anchored' : 'drawing.inline',
      runtimeNodes,
      sourceNode,
    };
  }

  if (xmlName === 'w:pict') {
    return {
      featureKey: 'vml.pict',
      runtimeNodes: asRuntimeNodes(encodedResult),
    };
  }

  const descriptor = NODE_FEATURES.get(xmlName);
  if (!descriptor) return null;

  const runtimeNodes = asRuntimeNodes(encodedResult).filter((node) => {
    if (!descriptor.runtimeNodeTypes?.length) return true;
    return typeof node.type === 'string' && descriptor.runtimeNodeTypes.includes(node.type);
  });

  if (runtimeNodes.length === 0) return null;

  return {
    featureKey: descriptor.featureKey,
    runtimeNodes,
  };
}

export function getFeatureKeyForPropertyTranslation(xmlName: string): string | undefined {
  return PROPERTY_FEATURES.get(xmlName);
}
