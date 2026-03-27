// ---------------------------------------------------------------------------
// Tier 0: Eager graph construction — stories, body structure, resources
//
// Built immediately after ready("structure"). Establishes the full graph
// skeleton including secondary stories (headers, footers, annotations)
// with their content, section entities, and resource entities.
// ---------------------------------------------------------------------------

import type { PackageSession, PackageViews } from "../types/session.js";
import type { EntityGraph, GraphContext } from "./types.js";
import type { EntityKind, StoryEntityKind } from "../entities/types.js";
import type { EntityRef } from "../identity/types.js";
import { createSourceRef } from "../identity/types.js";
import type { AnnotationCollectionView } from "../word/annotations-view.js";
import type { XmlElementNode } from "../types/xml.js";
import { EntityHandle } from "./entity-handle.js";
import { RefGenerator } from "./ref-generator.js";
import {
  computeChildPath,
  computePathFromRoot,
  qualifiedName,
} from "./source-path.js";
import { findChildElement } from "../word/tree-helpers.js";

/**
 * Build the Tier 0 entity graph: stories + body-child stubs + resources.
 * Returns the ref generator for continued use in Tier 1.
 */
export function constructTier0(
  views: PackageViews,
  _session: PackageSession,
  graph: EntityGraph,
  ctx: GraphContext,
): RefGenerator {
  const refs = new RefGenerator();

  // ---- Main story -----------------------------------------------------------
  const docView = views.document;
  if (docView) {
    const documentRoot = docView.rootElement();
    const bodyElement = documentRoot
      ? findChildElement(documentRoot, "body", "w")
      : undefined;
    const mainStoryPath = bodyElement ? qualifiedName(bodyElement) : undefined;
    const mainStoryRef = refs.next("mainStory");
    const mainStory = new EntityHandle(
      mainStoryRef, "mainStory",
      [createSourceRef(
        docView.partUri,
        bodyElement?.id ?? "",
        mainStoryPath,
      )],
      mainStoryRef.id, undefined, ctx,
    );
    graph.register(mainStory);

    if (bodyElement && mainStoryPath) {
      populateBodyChildren(
        bodyElement,
        mainStoryPath,
        docView.partUri,
        mainStoryRef,
        mainStory,
        graph,
        ctx,
        refs,
      );
    } else {
      populateBodyChildrenFromElements(
        docView.bodyChildren().map((c) => c.element),
        undefined,
        undefined,
        docView.partUri, mainStoryRef, mainStory,
        graph, ctx, refs,
      );
    }

    // Section entities from sectPr elements
    for (const sectionDesc of docView.sections()) {
      const ref = refs.next("section");
      const sourceRef = createSourceRef(
        docView.partUri,
        sectionDesc.sectPr.id,
        bodyElement && mainStoryPath
          ? computePathFromRoot(bodyElement, mainStoryPath, sectionDesc.sectPr)
          : undefined,
      );
      const entity = new EntityHandle(
        ref, "section", [sourceRef],
        mainStoryRef.id, undefined, ctx,
      );
      graph.register(entity);
      graph.indexSourceRef(sourceRef, ref);
      ctx.cacheElement(ref.id, sectionDesc.sectPr);
    }
  }

  // ---- Header/footer stories ------------------------------------------------
  constructHeaderFooterStories(views, graph, ctx, refs);

  // ---- Annotation stories (comments, footnotes, endnotes) -------------------
  constructAnnotationStories(views, graph, ctx, refs);

  // ---- Resource entities (styles, numbering, theme) -------------------------
  constructResourceEntities(views, graph, ctx, refs);

  return refs;
}

// ---- Shared: populate body children -----------------------------------------

function populateBodyChildren(
  containerElement: XmlElementNode,
  containerPath: string,
  partUri: string,
  storyRef: EntityRef,
  parentEntity: EntityHandle<EntityKind>,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  const elements = containerElement.children.filter(
    (child): child is XmlElementNode => child.kind === "element",
  );

  populateBodyChildrenFromElements(
    elements,
    containerElement,
    containerPath,
    partUri,
    storyRef,
    parentEntity,
    graph,
    ctx,
    refs,
  );
}

/**
 * Populate structural children from a known set of XML elements. This is the
 * shared worker for stories and annotation bodies.
 */
function populateBodyChildrenFromElements(
  elements: XmlElementNode[],
  parentElement: XmlElementNode | undefined,
  parentPath: string | undefined,
  partUri: string,
  storyRef: EntityRef,
  parentEntity: EntityHandle<EntityKind>,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  for (const el of elements) {
    if (el.kind !== "element") continue;
    const kind = classifyBodyChild(el.localName);
    const childRef = refs.next(kind);
    const path = parentElement && parentPath
      ? computeChildPath(parentElement, parentPath, el)
      : undefined;
    const sourceRef = createSourceRef(partUri, el.id, path);

    const entity = new EntityHandle(
      childRef, kind, [sourceRef],
      storyRef.id, parentEntity.ref, ctx,
    );

    graph.register(entity);
    graph.indexSourceRef(sourceRef, childRef);
    ctx.cacheElement(childRef.id, el);
    parentEntity.addChildRef(childRef);
  }
}

function classifyBodyChild(localName: string): "paragraph" | "table" | "contentControl" | "preservedBlock" {
  switch (localName) {
    case "p": return "paragraph";
    case "tbl": return "table";
    case "sdt": return "contentControl";
    default: return "preservedBlock";
  }
}

// ---- Header/footer stories --------------------------------------------------

function constructHeaderFooterStories(
  views: PackageViews,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  const hfView = views.headersFooters;
  if (!hfView) return;

  for (const desc of hfView.list()) {
    const rootElement = desc.element();
    const storyPath = rootElement ? qualifiedName(rootElement) : undefined;
    const storyKind: StoryEntityKind = desc.type === "header" ? "headerStory" : "footerStory";
    const storyRef = refs.next(storyKind);
    const story = new EntityHandle(
      storyRef, storyKind,
      [createSourceRef(desc.partUri, rootElement?.id ?? "", storyPath)],
      storyRef.id, undefined, ctx,
    );
    graph.register(story);

    // Populate with body children from the header/footer part
    if (!rootElement || !storyPath) continue;
    populateBodyChildren(rootElement, storyPath, desc.partUri, storyRef, story, graph, ctx, refs);

    // Create a headerFooterDefinition resource entity (distinct source ref)
    const hfDefRef = refs.next("headerFooterDefinition");
    const hfDefSourceRef = createSourceRef(desc.partUri, rootElement.id, storyPath);
    const hfDefEntity = new EntityHandle(
      hfDefRef, "headerFooterDefinition", [hfDefSourceRef],
      undefined, undefined, ctx,
    );
    graph.register(hfDefEntity);
    graph.indexSourceRef(hfDefSourceRef, hfDefRef);
    ctx.cacheElement(hfDefRef.id, rootElement);
  }
}

// ---- Annotation stories -----------------------------------------------------

function constructAnnotationStories(
  views: PackageViews,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  constructAnnotationStoryItems(
    views.footnotes, "/word/footnotes.xml", "footnoteStory", "footnoteBody",
    graph, ctx, refs,
  );
  constructAnnotationStoryItems(
    views.endnotes, "/word/endnotes.xml", "endnoteStory", "endnoteBody",
    graph, ctx, refs,
  );
  constructAnnotationStoryItems(
    views.comments, "/word/comments.xml", "commentStory", "commentThread",
    graph, ctx, refs,
  );
}

function constructAnnotationStoryItems(
  collectionView: AnnotationCollectionView | undefined,
  partUri: string,
  storyKind: StoryEntityKind,
  itemKind: EntityKind,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  if (!collectionView) return;

  const rootElement = collectionView.rootElement();
  const storyPath = rootElement ? qualifiedName(rootElement) : undefined;
  const storyRef = refs.next(storyKind);
  const story = new EntityHandle(
    storyRef, storyKind,
    [createSourceRef(partUri, rootElement?.id ?? "", storyPath)],
    storyRef.id, undefined, ctx,
  );
  graph.register(story);

  // Each annotation item becomes a child entity with its own content
  for (const desc of collectionView.list()) {
    const itemRef = refs.next(itemKind);
    const itemPath = rootElement && storyPath
      ? computePathFromRoot(rootElement, storyPath, desc.element)
      : undefined;
    const itemSourceRef = createSourceRef(partUri, desc.element.id, itemPath);
    const itemEntity = new EntityHandle(
      itemRef, itemKind, [itemSourceRef],
      storyRef.id, storyRef, ctx,
    );
    graph.register(itemEntity);
    graph.indexSourceRef(itemSourceRef, itemRef);
    ctx.cacheElement(itemRef.id, desc.element);
    story.addChildRef(itemRef);

    // Annotation item's children (w:p, w:tbl) become paragraph/table entities
    populateBodyChildrenFromElements(
      desc.element.children.filter(
        (child): child is XmlElementNode => child.kind === "element",
      ),
      desc.element,
      itemPath,
      partUri,
      storyRef,
      itemEntity,
      graph,
      ctx,
      refs,
    );
  }
}

// ---- Resource entities ------------------------------------------------------

function constructResourceEntities(
  views: PackageViews,
  graph: EntityGraph,
  ctx: GraphContext,
  refs: RefGenerator,
): void {
  // Styles
  const stylesView = views.styles;
  if (stylesView) {
    const rootElement = stylesView.rootElement();
    const rootPath = rootElement ? qualifiedName(rootElement) : undefined;
    for (const desc of stylesView.list()) {
      const ref = refs.next("style");
      const sourceRef = createSourceRef(
        "/word/styles.xml",
        desc.element.id,
        rootElement && rootPath
          ? computePathFromRoot(rootElement, rootPath, desc.element)
          : undefined,
      );
      const entity = new EntityHandle(ref, "style", [sourceRef], undefined, undefined, ctx);
      graph.register(entity);
      graph.indexSourceRef(sourceRef, ref);
      ctx.cacheElement(ref.id, desc.element);
    }
  }

  // Numbering definitions
  const numberingView = views.numbering;
  if (numberingView) {
    const rootElement = numberingView.rootElement();
    const rootPath = rootElement ? qualifiedName(rootElement) : undefined;
    for (const desc of numberingView.numInstances()) {
      const ref = refs.next("numberingDefinition");
      const sourceRef = createSourceRef(
        "/word/numbering.xml",
        desc.element.id,
        rootElement && rootPath
          ? computePathFromRoot(rootElement, rootPath, desc.element)
          : undefined,
      );
      const entity = new EntityHandle(
        ref, "numberingDefinition", [sourceRef], undefined, undefined, ctx,
      );
      graph.register(entity);
      graph.indexSourceRef(sourceRef, ref);
      ctx.cacheElement(ref.id, desc.element);
    }

    for (const desc of numberingView.abstractNums()) {
      const ref = refs.next("abstractNum");
      const sourceRef = createSourceRef(
        "/word/numbering.xml",
        desc.element.id,
        rootElement && rootPath
          ? computePathFromRoot(rootElement, rootPath, desc.element)
          : undefined,
      );
      const entity = new EntityHandle(
        ref, "abstractNum", [sourceRef], undefined, undefined, ctx,
      );
      graph.register(entity);
      graph.indexSourceRef(sourceRef, ref);
      ctx.cacheElement(ref.id, desc.element);
    }
  }

  // Theme
  const themeView = views.theme;
  if (themeView) {
    const rootEl = themeView.rootElement();
    if (rootEl) {
      const ref = refs.next("theme");
      const sourceRef = createSourceRef(themeView.partUri, rootEl.id, qualifiedName(rootEl));
      const entity = new EntityHandle(ref, "theme", [sourceRef], undefined, undefined, ctx);
      graph.register(entity);
      graph.indexSourceRef(sourceRef, ref);
      ctx.cacheElement(ref.id, rootEl);
    }
  }
}
