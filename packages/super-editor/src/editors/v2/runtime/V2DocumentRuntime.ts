import {
  open as openV2Model,
  projectToSemanticJson,
  DocumentApiAdapter as V2ModelDocumentApiAdapter,
  StyleResolver,
} from '@superdoc/v2-model';
import type {
  ArchiveByteSource,
  DocumentHandle as V2ModelDocumentHandle,
  SemanticDocument as V2ModelSemanticDocument,
  SemanticModel as V2ModelSemanticModel,
} from '@superdoc/v2-model';
import { v2PerfTimeline, SPAN_RUNTIME_INIT } from '@superdoc/v2-perf';

export type V2DocumentSource = Uint8Array | Blob | ArchiveByteSource;
export type V2SemanticModel = V2ModelSemanticModel;
export type V2SemanticDocument = V2ModelSemanticDocument;
export type V2DocumentApiAdapter = V2ModelDocumentApiAdapter;

/**
 * Small shared runtime for product-side v2 integrations.
 *
 * Responsibilities:
 * - open `@superdoc/v2-model` from a supported source
 * - wait for semantic structure readiness
 * - expose the semantic model, style resolver, and inspection helpers
 *
 * It intentionally does not own any rendering concerns.
 */
export class V2DocumentRuntime {
  #documentHandle: V2ModelDocumentHandle | null = null;
  #semanticModel: V2ModelSemanticModel | null = null;
  #styleResolver: StyleResolver | undefined;
  #documentApiAdapter: V2ModelDocumentApiAdapter | null = null;

  async initialize(source: V2DocumentSource): Promise<void> {
    const endInit = v2PerfTimeline.startSpan(SPAN_RUNTIME_INIT);
    await this.close();

    const documentHandle = await openV2Model(source);

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
    } finally {
      endInit();
    }
  }

  isActive(): boolean {
    return this.#semanticModel !== null;
  }

  get documentHandle(): V2ModelDocumentHandle | null {
    return this.#documentHandle;
  }

  get semanticModel(): V2ModelSemanticModel | null {
    return this.#semanticModel;
  }

  get styleResolver(): StyleResolver | undefined {
    return this.#styleResolver;
  }

  get semanticJson(): V2ModelSemanticDocument | undefined {
    return this.#semanticModel ? projectToSemanticJson(this.#semanticModel) : undefined;
  }

  get documentApiAdapter(): V2ModelDocumentApiAdapter | undefined {
    return this.#documentApiAdapter ?? undefined;
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
