import type { RecipeEdge, RecipeGraph, RecipeNode } from "../graph/recipeGraph.js";

const STEP_HEADING_RX = /^step\s*\d+$/i;
const TRIVIAL_STEP_DETAIL_MAX_LENGTH = 12;
const LABEL_MAX_LENGTH = 120;
const DETAIL_MAX_LENGTH = 500;
const REPAIR_DETAIL_MAX_LENGTH = 240;
const STRIP_QTY_MAX_PASSES = 4;
const MIN_DETAIL_LENGTH_AFTER_TRIM = 3;
const STEP_TYPE_NAMES = new Set(["prep", "cook", "wait", "assemble", "serve"]);

const MEASURE_ONLY_RX =
  /^\s*[\d./]+\s*(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|g|kg|mg|ml|l|oz|lb|pound|pounds|clove|cloves|pinch|dash)?\s*$/i;

const NUMBER_SIZE_ONLY_RX =
  /^\s*[\d./]+\s*(small|sm|medium|med|large|lg|xl|extra\s+large)\s*$/i;

/** Detect "Step N"-only nodes (no meaningful instruction) so they can be collapsed without losing structure. */
function isTrivialStepHeading(node: RecipeNode): boolean {
  if (node.type === "ingredient") return false;
  const label = String(node.label ?? "").trim();
  if (!STEP_HEADING_RX.test(label)) return false;
  const detail = String(node.detail ?? "").trim();
  if (detail === label) return true;
  if (detail.length === 0) return true;
  if (detail.length <= TRIVIAL_STEP_DETAIL_MAX_LENGTH && STEP_HEADING_RX.test(detail)) return true;
  return false;
}

/** Drop LLM-style "Step N" nodes with no real instruction; bridge `requires` edges. */
export function collapseTrivialStepHeadingNodes(graph: RecipeGraph): RecipeGraph {
  const trivialIds = new Set(
    graph.nodes.filter(isTrivialStepHeading).map((node) => node.id),
  );
  if (!trivialIds.size) return graph;

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edges: RecipeEdge[] = graph.edges.filter(
    (edge) => !trivialIds.has(edge.source) && !trivialIds.has(edge.target),
  );
  const bridgeKeys = new Set(
    edges.map((edge) => `${edge.source}\0${edge.target}\0${edge.type}`),
  );

  for (const trivialId of trivialIds) {
    const parents = graph.edges
      .filter((edge) => edge.target === trivialId && edge.type === "requires")
      .map((edge) => edge.source)
      .filter((id) => nodeIds.has(id) && !trivialIds.has(id));
    const children = graph.edges
      .filter((edge) => edge.source === trivialId && edge.type === "requires")
      .map((edge) => edge.target)
      .filter((id) => nodeIds.has(id) && !trivialIds.has(id));
    for (const parentId of parents) {
      for (const childId of children) {
        if (parentId === childId) continue;
        const bridgeKey = `${parentId}\0${childId}\0requires`;
        if (!bridgeKeys.has(bridgeKey)) {
          bridgeKeys.add(bridgeKey);
          edges.push({ source: parentId, target: childId, type: "requires" });
        }
      }
    }
  }

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !trivialIds.has(node.id)),
    edges,
  };
}

/** Split text into trimmed lines (keeps empty lines as empty strings). */
function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim());
}

/** Extract the "Ingredients" section as cleaned lines (best-effort; stops at "Instructions"). */
function extractIngredientLines(text: string): string[] {
  const allLines = splitLines(text);
  const ingredientsStart = allLines.findIndex((line) => /^ingredients\s*:?\s*$/i.test(line));
  if (ingredientsStart < 0) return [];
  const ingredientLines: string[] = [];
  for (let lineIndex = ingredientsStart + 1; lineIndex < allLines.length; lineIndex++) {
    const line = allLines[lineIndex];
    if (!line) continue;
    if (/^instructions\s*:?\s*$/i.test(line)) break;
    // keep bullet and non-bullet lines; remove leading bullet/numbering
    const cleaned = line.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "").trim();
    if (cleaned) ingredientLines.push(cleaned);
  }
  return ingredientLines;
}

/** Count ASCII letters (used as a proxy for "does this label contain a real ingredient name"). */
function alphaCount(text: string): number {
  const matches = text.match(/[a-zA-Z]/g);
  return matches ? matches.length : 0;
}

/** Detect "measure-only" labels like `1 tbsp` or `2 large` that should be replaced with a real ingredient name. */
function looksLikeJustMeasure(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return true;
  if (MEASURE_ONLY_RX.test(trimmed)) return true;
  if (NUMBER_SIZE_ONLY_RX.test(trimmed)) return true;
  if (alphaCount(trimmed) <= 1) return true;
  return false;
}

/** Strip quantity/package prefixes so checklist titles show ingredient names (detail keeps full line). */
function stripLeadingQtyForName(fullLine: string): string {
  let working = fullLine.trim();
  for (let pass = 0; pass < STRIP_QTY_MAX_PASSES; pass++) {
    const previous = working;
    working = working
      .replace(/^\s*\d+\s+\d+\/\d+\s+/, "")
      .replace(/^\s*\d+\/\d+\s+/, "")
      .replace(/^\s*\d+(?:\.\d+)?\s*(?:ml|cl|l|litres?|liters?|g|grams?|kg)\b\s*/i, "")
      .replace(/^\s*[\d.]+\s*\-\s*[\d.]+\s*/, "")
      .replace(/^\s*[\d.]+\s*/, "")
      .replace(
        /^\s*(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|g|kg|mg|ml|l|oz|lb|pound|pounds|clove|cloves|pinch|dash)\b\s*/i,
        "",
      )
      .replace(/^(carton|tub|jar|packet|pack|can|bottle)\s+(?:of\s+)?/i, "")
      .trim();
    if (working === previous) break;
  }
  return working
    .replace(/^(to serve|for serving|for garnish|to garnish|for dipping|for brushing)\b/i, "")
    .trim();
}

/** Escape regex metacharacters so a literal substring can be used in `RegExp` constructors. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Avoid subtitle "250ml Sour Cream" when the title is already "Sour Cream". */
function detailWithoutRepeatedName(label: string, fullLine: string): string {
  const detail = fullLine.trim();
  const trimmedLabel = label.trim();
  if (!trimmedLabel || !detail) return detail;
  const labelPattern = new RegExp(`(^|\\s)${escapeRegExp(trimmedLabel)}(\\s|$)`, "i");
  const trimmedDetail = detail.replace(labelPattern, " ").replace(/\s{2,}/g, " ").trim();
  return trimmedDetail.length >= MIN_DETAIL_LENGTH_AFTER_TRIM ? trimmedDetail : detail;
}

/** Derive a shorter ingredient name and preserve the full original ingredient line for detail. */
function deriveNameFromLine(line: string): { name: string; full: string } {
  const fullLine = line.trim();
  const stripped = stripLeadingQtyForName(fullLine);
  const name = stripped || fullLine;
  const detail = detailWithoutRepeatedName(name, fullLine);
  return { name, full: detail };
}

/** Id of the first prep/cook/wait/assemble/serve node in graph order, or null when the graph has no steps. */
function firstNonIngredientStepId(nodes: RecipeNode[]): string | null {
  for (const node of nodes) {
    if (STEP_TYPE_NAMES.has(node.type)) return node.id;
  }
  return null;
}

/**
 * Align ingredient nodes with the Ingredients section lines in `recipeText` (same order).
 * Ensures duplicate ingredients stay separate rows with shared labels but distinct detail lines.
 * When the recipe lists more lines than the parser emitted nodes, injects missing ingredient nodes and `uses` edges.
 */
export function syncIngredientNodesWithSourceLines(graph: RecipeGraph, recipeText: string): RecipeGraph {
  const sourceLines = extractIngredientLines(recipeText);
  if (!sourceLines.length) return collapseTrivialStepHeadingNodes(graph);

  const ingredientPositions: number[] = [];
  graph.nodes.forEach((node, nodeIndex) => {
    if (node.type === "ingredient") ingredientPositions.push(nodeIndex);
  });
  if (!ingredientPositions.length) return collapseTrivialStepHeadingNodes(graph);

  const nodesById = new Map(graph.nodes.map((node) => [node.id, { ...node }]));
  let edges = [...graph.edges];

  const pairCount = Math.min(ingredientPositions.length, sourceLines.length);
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
    const nodeId = graph.nodes[ingredientPositions[pairIndex]!]!.id;
    const node = nodesById.get(nodeId);
    if (!node) continue;
    const { name, full } = deriveNameFromLine(sourceLines[pairIndex]!);
    const nextLabel = (name || full).slice(0, LABEL_MAX_LENGTH);
    const nextDetail = full.slice(0, DETAIL_MAX_LENGTH);
    nodesById.set(nodeId, {
      ...node,
      label: nextLabel,
      detail: nextDetail,
    });
  }

  let nodes = graph.nodes.map((node) => nodesById.get(node.id) ?? node);

  if (sourceLines.length > ingredientPositions.length) {
    const templateId =
      graph.nodes[ingredientPositions[ingredientPositions.length - 1]!]!.id;
    const fromTemplate = edges.filter(
      (edge) => edge.type === "uses" && edge.source === templateId,
    );
    let useTargets = [...new Set(fromTemplate.map((edge) => edge.target))];
    if (!useTargets.length) {
      const firstStepId = firstNonIngredientStepId(nodes);
      if (firstStepId) useTargets = [firstStepId];
    }

    const extraLines = sourceLines.slice(ingredientPositions.length);
    const existingIds = new Set(nodes.map((node) => node.id));
    let nextSequenceId = 1;
    while (existingIds.has(`i${nextSequenceId}`)) nextSequenceId++;

    const newNodes: RecipeNode[] = [];
    const newEdges: RecipeEdge[] = [];

    for (const extraLine of extraLines) {
      let id = `i${nextSequenceId}`;
      while (existingIds.has(id)) {
        nextSequenceId++;
        id = `i${nextSequenceId}`;
      }
      existingIds.add(id);
      const { name, full } = deriveNameFromLine(extraLine);
      newNodes.push({
        id,
        type: "ingredient",
        label: (name || full).slice(0, LABEL_MAX_LENGTH),
        detail: full.slice(0, DETAIL_MAX_LENGTH),
        emoji: "🥗",
        lane: null,
        timeMinutes: null,
        ingredientIds: [],
      });
      for (const targetId of useTargets) {
        newEdges.push({ source: id, target: targetId, type: "uses" });
      }
      nextSequenceId++;
    }

    const firstStepIndex = nodes.findIndex((node) => node.type !== "ingredient");
    if (firstStepIndex >= 0) {
      nodes = [...nodes.slice(0, firstStepIndex), ...newNodes, ...nodes.slice(firstStepIndex)];
    } else {
      nodes = [...nodes, ...newNodes];
    }
    edges = [...edges, ...newEdges];
  }

  return collapseTrivialStepHeadingNodes({
    ...graph,
    nodes,
    edges,
  });
}

/** Sort ingredient nodes in numeric id order (e.g. `i1`, `i2`, ...) to align with parsed ingredient lines. */
function sortIngredientNodes(nodes: RecipeNode[]): RecipeNode[] {
  const parseNumericId = (id: string): number => {
    const match = id.match(/\d+/);
    return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
  };
  return [...nodes].sort(
    (firstNode, secondNode) => parseNumericId(firstNode.id) - parseNumericId(secondNode.id),
  );
}

/**
 * Patch ingredient nodes when an LLM produced "measure-only" labels by aligning them to parsed ingredient lines.
 *
 * Preserves graph shape, updates only low-signal ingredient labels/details, and finally collapses trivial "Step N"
 * headings so the result is easier to render.
 */
export function repairIngredientNodesFromRecipeText(
  graph: RecipeGraph,
  recipeText: string,
): RecipeGraph {
  const sourceLines = extractIngredientLines(recipeText);
  if (!sourceLines.length) return collapseTrivialStepHeadingNodes(graph);

  const ingredientNodes = graph.nodes.filter((node) => node.type === "ingredient");
  if (!ingredientNodes.length) return collapseTrivialStepHeadingNodes(graph);

  const orderedNodes = sortIngredientNodes(ingredientNodes);

  const nodesById = new Map<string, RecipeNode>();
  for (const node of graph.nodes) nodesById.set(node.id, node);

  const pairCount = Math.min(orderedNodes.length, sourceLines.length);
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
    const node = orderedNodes[pairIndex];
    const currentLabel = String(node.label ?? "").trim();
    if (!looksLikeJustMeasure(currentLabel)) continue;

    const { name, full } = deriveNameFromLine(sourceLines[pairIndex]);
    const nextLabel = name.slice(0, LABEL_MAX_LENGTH);
    const nextDetail = full.slice(0, REPAIR_DETAIL_MAX_LENGTH);
    nodesById.set(node.id, {
      ...node,
      label: nextLabel,
      detail: nextDetail,
    });
  }

  return collapseTrivialStepHeadingNodes({
    ...graph,
    nodes: graph.nodes.map((node) => nodesById.get(node.id) ?? node),
  });
}
