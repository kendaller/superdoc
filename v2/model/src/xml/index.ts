export { buildLexicalIndex } from "./indexer.js";
export type { BoundaryConfig } from "./indexer.js";
export { hydrateDocument, hydrateRegion } from "./hydrator.js";
export { serializeXmlDocument, serializeNode } from "./serializer.js";
export { indexXmlParts, indexPartOnDemand } from "./index-integration.js";
export { makeNodeId, makeSubNodeId, makeSyntheticId } from "./node-id.js";
export { buildCharToByteMap, detectXmlEncoding, findOpenAngleBracket } from "./byte-mapping.js";
export { parseXmlDeclaration } from "./declaration-parser.js";
