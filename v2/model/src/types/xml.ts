// ---------------------------------------------------------------------------
// XML concrete tree types — lossless, boundary-oriented representation
// ---------------------------------------------------------------------------

/** Byte-level span pointing back into original part bytes. */
export type SourceSpan = {
  startByte: number;
  endByte: number;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
};

// ---- Concrete tree nodes --------------------------------------------------

export type XmlDocumentNode = {
  id: string;
  kind: "document";
  declaration?: XmlDeclarationNode;
  children: XmlTopLevelNode[];
  sourceSpan?: SourceSpan;
};

export type XmlTopLevelNode =
  | XmlElementNode
  | XmlCommentNode
  | XmlProcessingInstructionNode;

export type XmlNode =
  | XmlElementNode
  | XmlTextNode
  | XmlCDataNode
  | XmlCommentNode
  | XmlProcessingInstructionNode;

export type XmlDeclarationNode = {
  id: string;
  kind: "declaration";
  version: string;
  encoding?: string;
  standalone?: "yes" | "no";
  raw?: string;
  sourceSpan?: SourceSpan;
};

export type XmlElementNode = {
  id: string;
  kind: "element";
  prefix?: string;
  localName: string;
  namespaceUri?: string;
  attributes: XmlAttributeNode[];
  namespaceDecls: XmlNamespaceDecl[];
  children: XmlNode[];
  sourceSpan?: SourceSpan;
};

export type XmlAttributeNode = {
  id: string;
  prefix?: string;
  localName: string;
  namespaceUri?: string;
  value: string;
  sourceSpan?: SourceSpan;
};

export type XmlNamespaceDecl = {
  id: string;
  prefix?: string;
  uri: string;
  sourceSpan?: SourceSpan;
};

export type XmlTextNode = {
  id: string;
  kind: "text";
  value: string;
  sourceSpan?: SourceSpan;
};

export type XmlCDataNode = {
  id: string;
  kind: "cdata";
  value: string;
  sourceSpan?: SourceSpan;
};

export type XmlCommentNode = {
  id: string;
  kind: "comment";
  value: string;
  sourceSpan?: SourceSpan;
};

export type XmlProcessingInstructionNode = {
  id: string;
  kind: "pi";
  target: string;
  value: string;
  sourceSpan?: SourceSpan;
};

// ---- Lexical index types --------------------------------------------------

/** Sparse boundary-oriented index built in a single forward pass. */
export type XmlLexicalIndex = {
  density: "sparse";
  declaration?: XmlDeclarationNode;
  rootElementId?: string;
  indexedNodeIds: string[];
  recordsById: Map<string, XmlStructuralRecord>;
  regions: XmlStructuralRegion[];
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "unknown";
};

export type XmlStructuralRecord = {
  id: string;
  role: "root" | "boundary" | "anchor";
  kind: "element" | "text" | "cdata" | "comment" | "pi";
  parentId?: string;
  depth: number;
  prefix?: string;
  localName?: string;
  namespaceUri?: string;
  fullSpan: SourceSpan;
  openTagSpan?: SourceSpan;
  contentSpan?: SourceSpan;
  closeTagSpan?: SourceSpan;
  attributeSpanCount?: number;
  namespaceDeclSpanCount?: number;
  childBoundaryIds?: string[];
  descendantCount?: number;
  hydrationBoundary: boolean;
};

export type XmlStructuralRegion = {
  id: string;
  kind: "root" | "top-level-child" | "subtree" | "custom";
  classification?: string;
  span: SourceSpan;
  anchorNodeId?: string;
};

// ---- Hydration types ------------------------------------------------------

export type HydratedRegionIndex = Map<string, HydratedXmlRegion>;

export type HydratedXmlRegion = {
  regionId: string;
  span: SourceSpan;
  tree: XmlNode[];
  parentId?: string;
  /** Whether this region has been mutated and needs serialization on save. */
  dirty?: boolean;
};

// ---- Tree state -----------------------------------------------------------

export type XmlTreeState =
  | { kind: "indexed-only" }
  | { kind: "partially-hydrated"; hydratedRegions: HydratedRegionIndex }
  | { kind: "fully-hydrated"; tree: XmlDocumentNode }
  | { kind: "mutated"; tree: XmlDocumentNode };

// ---- Node resolution index ------------------------------------------------

/**
 * O(1) lookup index for nodes in a fully-hydrated or mutated XML part.
 * Built once on full hydration, updated incrementally by mutation step appliers.
 */
export type NodeIndex = {
  /** nodeId → the node object in the hydrated tree */
  byId: Map<string, XmlNode>;
  /** nodeId → parent nodeId (top-level children's parent is undefined) */
  parentOf: Map<string, string | undefined>;
  /** nodeId → index within parent's children array */
  childIndexOf: Map<string, number>;
};
