// ---------------------------------------------------------------------------
// XML lexical indexer — single forward pass using saxes
//
// Produces a sparse XmlLexicalIndex with boundary-oriented structural records
// and region boundaries. Does NOT produce a full tree — that's hydration's job.
// ---------------------------------------------------------------------------

import { SaxesParser } from 'saxes';
import type { XmlLexicalIndex, XmlStructuralRecord, XmlStructuralRegion, SourceSpan } from '../types/xml.js';
import { makeNodeId } from './node-id.js';
import {
  createCharToByteResolver,
  detectXmlEncoding,
  findOpenAngleBracket,
  assertUtf8Encoding,
} from './byte-mapping.js';
import { parseXmlDeclaration } from './declaration-parser.js';

// ---- Configuration --------------------------------------------------------

export type BoundaryConfig = {
  /** Depth at which children become hydration boundaries.
   *  depth=1 means root's direct children are boundaries. */
  boundaryDepth: number;
  /** QNames whose direct children are always boundaries. */
  boundaryParents?: Set<string>;
};

const DEFAULT_BOUNDARY: BoundaryConfig = { boundaryDepth: 1 };

// ---- Public API -----------------------------------------------------------

/**
 * Build a sparse XmlLexicalIndex in a single forward pass.
 *
 * Only root and boundary-depth elements get structural records.
 * Interior nodes are left for on-demand hydration.
 */
export function buildLexicalIndex(
  bytes: Uint8Array,
  partUri: string,
  config: BoundaryConfig = DEFAULT_BOUNDARY,
): XmlLexicalIndex {
  assertUtf8Encoding(bytes, partUri);
  const text = new TextDecoder('utf-8').decode(bytes);
  const charToByte = createCharToByteResolver(text, bytes);
  const encoding = detectXmlEncoding(bytes);

  const recordsById = new Map<string, XmlStructuralRecord>();
  const indexedNodeIds: string[] = [];
  const regions: XmlStructuralRegion[] = [];
  let rootElementId: string | undefined;

  // ---- Parse the XML declaration manually (saxes doesn't always fire it) --
  const declaration = parseXmlDeclaration(text, partUri);

  // ---- Stack-based tracking -----------------------------------------------
  const stack: StackFrame[] = [];
  let depth = 0;

  const parser = new SaxesParser({ xmlns: true, position: true });

  parser.on('opentag', (node) => {
    depth++;
    // parser.position is the char index right after the `>` of the open tag.
    // Scan backwards in the text to find the `<` that started it.
    const tagStartChar = findOpenAngleBracket(text, parser.position);
    const startByte = charToByte(tagStartChar);

    const frame: StackFrame = {
      localName: node.local,
      prefix: node.prefix || undefined,
      uri: node.uri || undefined,
      depth,
      startByte,
      descendants: 0,
      childBoundaryIds: [],
      isSelfClosing: node.isSelfClosing === true,
    };

    // Determine role
    if (depth === 1) {
      frame.role = 'root';
    } else if (isAtBoundaryDepth(depth, config, stack)) {
      frame.role = 'boundary';
    }

    stack.push(frame);

    // If self-closing, trigger close logic immediately.
    // saxes fires closetag for self-closing tags too, so we let it handle it.
  });

  parser.on('closetag', () => {
    const frame = stack.pop();
    if (!frame) return;

    // parser.position is 0-based char index AFTER the `>` of the close tag
    const endChar = parser.position;
    const endByte = charToByte(endChar);

    // Update parent's descendant count
    if (stack.length > 0) {
      stack[stack.length - 1].descendants += 1 + frame.descendants;
    }

    // Create a structural record for root/boundary elements
    if (frame.role) {
      const fullSpan: SourceSpan = {
        startByte: frame.startByte,
        endByte,
      };
      const id = makeNodeId(partUri, 'element', fullSpan);

      const record: XmlStructuralRecord = {
        id,
        role: frame.role,
        kind: 'element',
        depth: frame.depth,
        prefix: frame.prefix,
        localName: frame.localName,
        namespaceUri: frame.uri,
        fullSpan,
        childBoundaryIds: frame.childBoundaryIds.length > 0 ? frame.childBoundaryIds : undefined,
        descendantCount: frame.descendants,
        hydrationBoundary: frame.role === 'boundary',
      };

      // Link to nearest recorded ancestor
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].recordId) {
          record.parentId = stack[i].recordId;
          break;
        }
      }

      recordsById.set(id, record);
      indexedNodeIds.push(id);
      frame.recordId = id;

      if (frame.role === 'root') rootElementId = id;

      // Register as child boundary on parent
      if (frame.role === 'boundary' && stack.length > 0) {
        stack[stack.length - 1].childBoundaryIds.push(id);
      }

      // Create region for each boundary
      if (frame.role === 'boundary') {
        regions.push({
          id: `region:${id}`,
          kind: 'subtree',
          span: fullSpan,
          anchorNodeId: id,
        });
      }
    }

    depth--;
  });

  parser.write(text);
  parser.close();

  // Prepend root region
  if (rootElementId) {
    const rootRec = recordsById.get(rootElementId);
    if (rootRec) {
      regions.unshift({
        id: 'region:root',
        kind: 'root',
        span: rootRec.fullSpan,
        anchorNodeId: rootElementId,
      });
    }
  }

  return {
    density: 'sparse',
    declaration,
    rootElementId,
    indexedNodeIds,
    recordsById,
    regions,
    encoding,
  };
}

// ---- Stack frame ----------------------------------------------------------

type StackFrame = {
  localName: string;
  prefix?: string;
  uri?: string;
  depth: number;
  startByte: number;
  descendants: number;
  childBoundaryIds: string[];
  isSelfClosing: boolean;
  role?: 'root' | 'boundary' | 'anchor';
  recordId?: string;
};

// ---- Boundary logic -------------------------------------------------------

function isAtBoundaryDepth(depth: number, config: BoundaryConfig, stack: StackFrame[]): boolean {
  if (depth === config.boundaryDepth + 1) return true;

  if (config.boundaryParents && stack.length >= 1) {
    const parent = stack[stack.length - 1];
    const qname = parent.prefix ? `${parent.prefix}:${parent.localName}` : parent.localName;
    if (config.boundaryParents.has(qname)) return true;
  }

  return false;
}
