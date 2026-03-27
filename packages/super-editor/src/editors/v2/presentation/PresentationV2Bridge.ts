import type { FlowBlock } from '@superdoc/contracts';
import { hydrateImageBlocks } from '@superdoc/pm-adapter';
import {
  projectToFlowBlocks as projectToFlowBlocksV2,
} from '@superdoc/v2-model';
import { mergePmMetadataIntoV2Blocks } from './V2ShadowParity.js';
import {
  V2DocumentRuntime,
  type V2DocumentApiAdapter as PresentationV2DocumentApiAdapter,
  type V2SemanticDocument as PresentationV2SemanticDocument,
  type V2SemanticModel as PresentationV2SemanticModel,
} from '../runtime/V2DocumentRuntime.js';

type MediaFiles = Record<string, string>;

export type V2ProjectionInput = {
  shadowBlocks: readonly FlowBlock[];
  shadowBookmarks?: ReadonlyMap<string, number>;
  mediaFiles: MediaFiles;
};

export type V2ProjectionOutput = {
  blocks: FlowBlock[];
  bookmarks: Map<string, number>;
};

/**
 * Presentation-layer bridge for the v2 semantic pipeline.
 *
 * The host editor remains responsible for lifecycle, scheduling, and fallback
 * behavior. This bridge only owns:
 * - opening `@superdoc/v2-model` from raw DOCX bytes
 * - exposing semantic inspection surfaces
 * - projecting semantic blocks into the existing FlowBlock pipeline
 */
export class PresentationV2Bridge {
  #runtime = new V2DocumentRuntime();

  async initialize(docxSource: Uint8Array | Blob): Promise<void> {
    await this.#runtime.initialize(docxSource);
  }

  isActive(): boolean {
    return this.#runtime.isActive();
  }

  getSemanticModel(): PresentationV2SemanticModel | null {
    return this.#runtime.semanticModel;
  }

  getSemanticJson(): PresentationV2SemanticDocument | undefined {
    return this.#runtime.semanticJson;
  }

  getSemanticDocumentApiAdapter(): PresentationV2DocumentApiAdapter | undefined {
    return this.#runtime.documentApiAdapter;
  }

  projectFlowBlocks({ shadowBlocks, shadowBookmarks, mediaFiles }: V2ProjectionInput): V2ProjectionOutput {
    const semanticModel = this.#runtime.semanticModel;
    if (!semanticModel) {
      throw new Error('Cannot project v2 FlowBlocks before the semantic model is initialized');
    }

    const v2Result = projectToFlowBlocksV2(semanticModel, {
      resolver: this.#runtime.styleResolver,
    });

    const blocksWithShadowMetadata = mergePmMetadataIntoV2Blocks(v2Result.blocks as FlowBlock[], shadowBlocks);

    return {
      blocks: hydrateImageBlocks(blocksWithShadowMetadata, mediaFiles),
      bookmarks: shadowBookmarks ? new Map(shadowBookmarks) : new Map(),
    };
  }

  async close(): Promise<void> {
    await this.#runtime.close();
  }
}
