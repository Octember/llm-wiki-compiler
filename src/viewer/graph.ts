/**
 * Graph data builder for the viewer's `#/graph` route.
 *
 * Converts the flat `DefaultViewerPage[]` list from the startup snapshot into an
 * adjacency representation suitable for D3 force-directed rendering. Called
 * once by `buildViewerSnapshot` — the result is frozen in the snapshot and
 * served directly by `/api/graph` with no per-request computation.
 */

import { resolvePageKind } from "./page-fields.js";
import { isQualifiedKey } from "../wiki/wikilink-target.js";
import type { DefaultViewerPage } from "./types.js";
import type { GraphData, GraphEdge, GraphNode, GraphNodeId, PageId } from "./types.js";
import type { EntityId } from "../profile/types.js";

/**
 * A wikilink or dangling-target edge: the public {@link GraphEdge} without the
 * relation-only fields. Its endpoints are page ids, ghost ids, or — for a
 * qualified `[[person/karl-marrett]]` link — a typed entity node's id.
 */
interface WikilinkEdge {
  source: GraphNodeId;
  target: GraphNodeId;
}

/**
 * Minimal typed-entity-page input for {@link buildGraphData}: just the identity
 * (`id`/`slug`/`directory`) plus the declared `entityType` and optional display
 * `title`. A trimmed shape (not the full collector `EntityPage`) so the graph
 * builder stays decoupled from frontmatter/body and the call site can pass a
 * cheap projection.
 */
export interface EntityPageNode {
  /** Branded `<entityType>/<slug>` identity; the node's key. */
  id: EntityId;
  /** Declared profile entity type, e.g. `"person"`. */
  entityType: string;
  /** Validated filename stem. */
  slug: string;
  /** Source directory the entity page lives in. */
  directory: string;
  /** Display title; falls back to `slug` when absent. */
  title?: string;
  /** The page's resolved wikilinks; each one to a node in the graph becomes a wikilink edge. */
  outgoingLinks?: readonly GraphNodeId[];
}

/**
 * Minimal typed-relation input for {@link buildGraphData}: the relation `type`
 * plus its two entity endpoints. Becomes one directed edge (`from`→`to`) tagged
 * with `edgeKind: "relation"` / `relationType`. The optional `direction` field
 * comes from the profile's relation-type def and is carried through to the edge
 * so the client can distinguish symmetric (undirected) from directed edges.
 */
export interface RelationEdge {
  /** Relation-type id (a key of `profile.relations`). */
  type: string;
  /** `from` endpoint entity id. */
  from: EntityId;
  /** `to` endpoint entity id. */
  to: EntityId;
  /** Relation-type directionality from the profile def (additive; absent → client treats as directed). */
  direction?: "directed" | "symmetric";
}

/**
 * Optional, ADDITIVE typed-graph inputs. When ABSENT or empty (every default
 * project, and every relation/entity-less profile) {@link buildGraphData}
 * returns output byte-identical to the wikilink-only graph — no typed nodes or
 * edges are appended and no existing node/edge field is perturbed.
 */
export interface GraphBuildOptions {
  /** Typed entity pages to surface as nodes (CLP 4b). */
  entityPages?: EntityPageNode[];
  /** Typed relations to surface as edges (CLP 4b). */
  relations?: RelationEdge[];
}

/**
 * Build graph adjacency data from the page list. All outgoing links become
 * edges — including dangling ones whose target has no backing page. Dangling
 * targets appear as ghost nodes with `isDangling: true`. Real-node degree
 * counts only valid edges (dangling out-links do not inflate the source
 * node's out-degree).
 *
 * CLP 4b: `opts` ADDITIVELY surfaces typed entity pages (as nodes keyed by
 * their `EntityId`, tagged with `nodeKind: "entity"` + `entityType`) and typed
 * relations (as edges tagged with `edgeKind: "relation"` + `relationType`).
 * Typed nodes are appended AFTER the real+ghost wikilink nodes, sorted by
 * `EntityId` for rank-stable ordering; relation edges are appended AFTER the
 * wikilink edges. A relation endpoint with no backing entity node and no page
 * becomes a ghost node so a dangling relation can never break expansion. When
 * `opts` is absent/empty the output is byte-identical to the wikilink-only
 * graph (no field on an existing node/edge is touched).
 */
export function buildGraphData(pages: DefaultViewerPage[], opts?: GraphBuildOptions): GraphData {
  const entityPages = opts?.entityPages ?? [];
  // A link to a page outside the graph (a timeline day) draws no edge and no ghost.
  const nodeIds = new Set<GraphNodeId>([...pages, ...entityPages].map((page) => page.id));
  const edges = [...buildEdges(pages, nodeIds), ...entityPages.flatMap((page) => linkEdges(page, nodeIds))];
  const ghostDisplayMap = buildGhostDisplayMap(pages);
  const degree = buildDegreeMap(edges, nodeIds);
  const realNodes = pages.map((p) => buildNode(p, degree));
  const ghostNodes = buildGhostNodes(edges, nodeIds, degree, ghostDisplayMap);
  const base: GraphData = { nodes: [...realNodes, ...ghostNodes], edges };
  return appendTypedGraph(base, opts, degree);
}

/**
 * Append typed entity nodes + relation edges to the wikilink-only `base`,
 * additively. Returns `base` UNCHANGED (same object, byte-identical) when no
 * typed inputs are present. Relation endpoints with no backing entity node and
 * no page become ghost nodes so a dangling relation stays expansion-safe.
 */
function appendTypedGraph(
  base: GraphData,
  opts: GraphBuildOptions | undefined,
  linkDegree: ReadonlyMap<GraphNodeId, number>,
): GraphData {
  const entityPages = opts?.entityPages ?? [];
  const relations = opts?.relations ?? [];
  if (entityPages.length === 0 && relations.length === 0) return base;
  const relationDegree = buildRelationDegreeMap(relations);
  const entityNodes = buildEntityNodes(entityPages, relationDegree, linkDegree);
  const relationEdges = buildRelationEdges(relations);
  const knownIds = new Set<GraphNodeId>([...base.nodes, ...entityNodes].map((node) => node.id));
  const relationGhosts = buildRelationGhostNodes(relations, knownIds, relationDegree);
  return {
    nodes: [...base.nodes, ...entityNodes, ...relationGhosts],
    edges: [...base.edges, ...relationEdges],
  };
}

function buildGhostDisplayMap(pages: DefaultViewerPage[]): Map<GraphNodeId, string> {
  const map = new Map<GraphNodeId, string>();
  for (const page of pages) {
    for (const { slug, display } of page.danglingLinks ?? []) {
      const id = ghostId(slug);
      if (!map.has(id)) map.set(id, display);
    }
  }
  return map;
}

const GHOST_DIRECTORY = "concepts";

/**
 * Synthesise a stable id for an unresolved link so ghost nodes have a unique
 * key: a bare slug under `concepts/`, a qualified `dir/slug` as itself.
 */
function ghostId(slug: string): GraphNodeId {
  return (isQualifiedKey(slug) ? slug : `${GHOST_DIRECTORY}/${slug}`) as PageId;
}

/** A default page's edges: one per link to a node in the graph, then one per dangling link to its ghost. */
function buildEdges(pages: DefaultViewerPage[], nodeIds: ReadonlySet<GraphNodeId>): WikilinkEdge[] {
  return pages.flatMap((page) => [
    ...linkEdges(page, nodeIds),
    ...(page.danglingLinks ?? []).map(({ slug }) => ({ source: page.id, target: ghostId(slug) })),
  ]);
}

/** One wikilink edge per link of a page to a node in the graph. */
function linkEdges(page: { id: GraphNodeId; outgoingLinks?: readonly GraphNodeId[] }, nodeIds: ReadonlySet<GraphNodeId>): WikilinkEdge[] {
  return (page.outgoingLinks ?? []).filter((target) => nodeIds.has(target)).map((target) => ({ source: page.id, target }));
}

/** A ghost node for an id nothing in the graph backs: `directory/slug`, titled by its slug unless a title is given. */
function ghostNode(id: GraphNodeId, degree: number, title?: string): GraphNode {
  const [directory, ...rest] = id.split("/");
  const slug = rest.join("/");
  return { id, title: title ?? slug, slug, directory, kind: "dangling", degree, isDangling: true };
}

function buildGhostNodes(
  edges: WikilinkEdge[],
  nodeIds: ReadonlySet<GraphNodeId>,
  degree: ReadonlyMap<GraphNodeId, number>,
  displayMap: Map<GraphNodeId, string>,
): GraphNode[] {
  const seen = new Set<GraphNodeId>();
  const ghosts: GraphNode[] = [];
  for (const { target } of edges) {
    if (nodeIds.has(target) || seen.has(target)) continue;
    seen.add(target);
    ghosts.push(ghostNode(target, degree.get(target) ?? 0, displayMap.get(target)));
  }
  return ghosts;
}

/**
 * Each node's wikilink degree: an edge counts for its target, and for its source
 * when the target is a node in the graph, so a link to a ghost counts only for the ghost.
 */
function buildDegreeMap(edges: WikilinkEdge[], nodeIds: ReadonlySet<GraphNodeId>): Map<GraphNodeId, number> {
  const map = new Map<GraphNodeId, number>();
  const count = (id: GraphNodeId): void => void map.set(id, (map.get(id) ?? 0) + 1);
  for (const { source, target } of edges) {
    count(target);
    if (nodeIds.has(target)) count(source);
  }
  return map;
}

function buildNode(page: DefaultViewerPage, degree: ReadonlyMap<GraphNodeId, number>): GraphNode {
  const kind = resolvePageKind(page.frontmatter);
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    directory: page.pageDirectory,
    kind,
    degree: degree.get(page.id) ?? 0,
  };
}

/** Tally every relation's incident degree per endpoint id (both `from` and `to`). */
function buildRelationDegreeMap(relations: RelationEdge[]): Map<GraphNodeId, number> {
  const map = new Map<GraphNodeId, number>();
  for (const rel of relations) {
    map.set(rel.from, (map.get(rel.from) ?? 0) + 1);
    map.set(rel.to, (map.get(rel.to) ?? 0) + 1);
  }
  return map;
}

/**
 * Build one typed entity node per entity page, sorted by `EntityId` so the
 * appended block has a deterministic, rank-stable order independent of the
 * collector's iteration order. Degree counts relation edges plus the node's
 * wikilinks in both directions. `kind` carries the `entityType` and the
 * `nodeKind`/`entityType` discriminators mark it as typed.
 */
function buildEntityNodes(
  entityPages: EntityPageNode[],
  relationDegree: ReadonlyMap<GraphNodeId, number>,
  linkDegree: ReadonlyMap<GraphNodeId, number>,
): GraphNode[] {
  return [...entityPages]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((page) => ({
      id: page.id,
      title: page.title ?? page.slug,
      slug: page.slug,
      directory: page.directory,
      kind: page.entityType,
      degree: (relationDegree.get(page.id) ?? 0) + (linkDegree.get(page.id) ?? 0),
      nodeKind: "entity" as const,
      entityType: page.entityType,
    }));
}

/** Map each relation to one relation-tagged edge (`from`→`to`), carrying direction when supplied. */
function buildRelationEdges(relations: RelationEdge[]): GraphEdge[] {
  return relations.map((rel) => ({
    source: rel.from,
    target: rel.to,
    edgeKind: "relation" as const,
    relationType: rel.type,
    ...(rel.direction !== undefined ? { direction: rel.direction } : {}),
  }));
}

/**
 * Synthesise a ghost node for any relation endpoint with no backing entity node
 * and no page — reusing the `isDangling` ghost mechanism so a dangling relation
 * appears as a broken target rather than breaking expansion. Deterministic
 * order: sorted by id, first-seen deduped. Directory/slug are derived from the
 * `<entityType>/<slug>` endpoint shape.
 */
function buildRelationGhostNodes(
  relations: RelationEdge[],
  knownIds: ReadonlySet<GraphNodeId>,
  relationDegree: ReadonlyMap<GraphNodeId, number>,
): GraphNode[] {
  const missing = new Set<GraphNodeId>();
  for (const rel of relations) {
    if (!knownIds.has(rel.from)) missing.add(rel.from);
    if (!knownIds.has(rel.to)) missing.add(rel.to);
  }
  return [...missing].sort((a, b) => a.localeCompare(b)).map((id) => ghostNode(id, relationDegree.get(id) ?? 0));
}
