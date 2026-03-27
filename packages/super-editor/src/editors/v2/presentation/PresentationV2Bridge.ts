import type { FlowBlock } from '@superdoc/contracts';
import { hydrateImageBlocks } from '@superdoc/pm-adapter';
import {
  open as openV2Model,
  projectToFlowBlocks as projectToFlowBlocksV2,
  projectToSemanticJson,
  DocumentApiAdapter as V2ModelDocumentApiAdapter,
  StyleResolver,
} from '@superdoc/v2-model';
import type {
  DocumentHandle as V2DocumentHandle,
  SemanticDocument as V2SemanticDocument,
  SemanticModel as V2SemanticModel,
} from '@superdoc/v2-model';
import { mergePmMetadataIntoV2Blocks } from './V2ShadowParity.js';

type MediaFiles = Record<string, string>;

export type PresentationV2SemanticModel = V2SemanticModel;
export type PresentationV2SemanticDocument = V2SemanticDocument;
export type PresentationV2DocumentApiAdapter = V2ModelDocumentApiAdapter;

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
  #documentHandle: V2DocumentHandle | null = null;
  #semanticModel: V2SemanticModel | null = null;
  #styleResolver: StyleResolver | undefined;
  #documentApiAdapter: V2ModelDocumentApiAdapter | null = null;

  async initialize(docxBytes: Uint8Array): Promise<void> {
    await this.close();

    const documentHandle = await openV2Model({ kind: 'memory', bytes: docxBytes });

    try {
      await documentHandle.ready('structure');

      const semanticModel = documentHandle.semanticModel();
      if (!semanticModel) {
        throw new Error('v2/model handle did not produce a semantic model after ready("structure")');
      }

      const views = documentHandle.views();

      this.#documentHandle = documentHandle;
      this.#semanticModel = semanticModel;
      this.#documentApiAdapter = new V2ModelDocumentApiAdapter(semanticModel);
      this.#styleResolver = new StyleResolver(views.styles?.rootElement(), views.numbering?.rootElement());
    } catch (error) {
      await documentHandle.close().catch(() => {});
      this.#reset();
      throw error;
    }
  }

  isActive(): boolean {
    return this.#semanticModel !== null;
  }

  getSemanticModel(): PresentationV2SemanticModel | null {
    return this.#semanticModel;
  }

  getSemanticJson(): PresentationV2SemanticDocument | undefined {
    return this.#semanticModel ? projectToSemanticJson(this.#semanticModel) : undefined;
  }

  getSemanticDocumentApiAdapter(): PresentationV2DocumentApiAdapter | undefined {
    return this.#documentApiAdapter ?? undefined;
  }

  projectFlowBlocks({ shadowBlocks, shadowBookmarks, mediaFiles }: V2ProjectionInput): V2ProjectionOutput {
    const semanticModel = this.#semanticModel;
    if (!semanticModel) {
      throw new Error('Cannot project v2 FlowBlocks before the semantic model is initialized');
    }

    const v2Result = projectToFlowBlocksV2(semanticModel, {
      resolver: this.#styleResolver,
    });

    const blocksWithShadowMetadata = mergePmMetadataIntoV2Blocks(v2Result.blocks as FlowBlock[], shadowBlocks);

    return {
      blocks: hydrateImageBlocks(blocksWithShadowMetadata, mediaFiles),
      bookmarks: shadowBookmarks ? new Map(shadowBookmarks) : new Map(),
    };
  }

  async close(): Promise<void> {
    const documentHandle = this.#documentHandle;
    this.#reset();

    if (documentHandle) {
      await documentHandle.close().catch(() => {});
    }
  }

  #reset(): void {
    this.#documentHandle = null;
    this.#semanticModel = null;
    this.#styleResolver = undefined;
    this.#documentApiAdapter = null;
  }
}
