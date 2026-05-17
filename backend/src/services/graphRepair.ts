import type { RecipeEdge, RecipeGraph, RecipeNode } from "../graph/recipeGraph.js";

const STEP_HEADING_RX = /^step\s*\d+$/i;

/** Detect “Step N”-only nodes (no meaningful instruction) so they can be collapsed without losing structure. */
function isTrivialStepHeading(n: RecipeNode): boolean {
  if (n.type === "ingredient") return false;
  const lab = String(n.label ?? "").trim();
  if (!STEP_HEADING_RX.test(lab)) return false;
  const det = String(n.detail ?? "").trim();
  if (det === lab) return true;
  if (det.length === 0) return true;
  if (det.length <= 12 && STEP_HEADING_RX.test(det)) return true;
  return false;
}

/** Drop LLM-style "Step N" nodes with no real instruction; bridge `requires` edges. */
export function collapseTrivialStepHeadingNodes(graph: RecipeGraph): RecipeGraph {
  const trivial = new Set(graph.nodes.filter(isTrivialStepHeading).map((n) => n.id));
  if (!trivial.size) return graph;

  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const edges: RecipeEdge[] = graph.edges.filter(
    (e) => !trivial.has(e.source) && !trivial.has(e.target),
  );
  const bridgeKeys = new Set(edges.map((e) => `${e.source}\0${e.target}\0${e.type}`));

  for (const rid of trivial) {
    const parents = graph.edges
      .filter((e) => e.target === rid && e.type === "requires")
      .map((e) => e.source)
      .filter((id) => nodeIds.has(id) && !trivial.has(id));
    const children = graph.edges
      .filter((e) => e.source === rid && e.type === "requires")
      .map((e) => e.target)
      .filter((id) => nodeIds.has(id) && !trivial.has(id));
    for (const p of parents) {
      for (const c of children) {
        if (p === c) continue;
        const key = `${p}\0${c}\0requires`;
        if (!bridgeKeys.has(key)) {
          bridgeKeys.add(key);
          edges.push({ source: p, target: c, type: "requires" });
        }
      }
    }
  }

  return {
    ...graph,
    nodes: graph.nodes.filter((n) => !trivial.has(n.id)),
    edges,
  };
}

/** Split text into trimmed lines (keeps empty lines as empty strings). */
function lines(text: string): string[] {
  return text.split(/\r?\n/).map((s) => s.trim());
}

/** Extract the “Ingredients” section as cleaned lines (best-effort; stops at “Instructions”). */
function extractIngredientLines(text: string): string[] {
  const ls = lines(text);
  const start = ls.findIndex((l) => /^ingredients\s*:?\s*$/i.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < ls.length; i++) {
    const l = ls[i];
    if (!l) continue;
    if (/^instructions\s*:?\s*$/i.test(l)) break;
    // keep bullet and non-bullet lines; remove leading bullet/numbering
    const cleaned = l.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "").trim();
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/** Count ASCII letters (used as a proxy for “does this label contain a real ingredient name”). */
function alphaCount(s: string): number {
  const m = s.match(/[a-zA-Z]/g);
  return m ? m.length : 0;
}

const MEASURE_ONLY_RX =
  /^\s*[\d./]+\s*(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|g|kg|mg|ml|l|oz|lb|pound|pounds|clove|cloves|pinch|dash)?\s*$/i;

const NUMBER_SIZE_ONLY_RX =
  /^\s*[\d./]+\s*(small|sm|medium|med|large|lg|xl|extra\s+large)\s*$/i;

/** Detect “measure-only” labels like `1 tbsp` or `2 large` that should be replaced with a real ingredient name. */
function looksLikeJustMeasure(label: string): boolean {
  const t = label.trim();
  if (!t) return true;
  if (MEASURE_ONLY_RX.test(t)) return true;
  if (NUMBER_SIZE_ONLY_RX.test(t)) return true;
  if (alphaCount(t) <= 1) return true;
  return false;
}

/** Strip quantity/package prefixes so checklist titles show ingredient names (detail keeps full line). */
function stripLeadingQtyForName(full: string): string {
  let s = full.trim();
  for (let pass = 0; pass < 4; pass++) {
    const prev = s;
    s = s
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
    if (s === prev) break;
  }
  return s.replace(/^(to serve|for serving|for garnish|to garnish|for dipping|for brushing)\b/i, "").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Avoid subtitle "250ml Sour Cream" when the title is already "Sour Cream". */
function detailWithoutRepeatedName(label: string, full: string): string {
  const d = full.trim();
  const lab = label.trim();
  if (!lab || !d) return d;
  const re = new RegExp(`(^|\\s)${escapeRegExp(lab)}(\\s|$)`, "i");
  const trimmed = d.replace(re, " ").replace(/\s{2,}/g, " ").trim();
  return trimmed.length >= 3 ? trimmed : d;
}

/** Derive a shorter ingredient name and preserve the full original ingredient line for detail. */
function deriveNameFromLine(line: string): { name: string; full: string } {
  const full = line.trim();
  let s = stripLeadingQtyForName(full);
  const name = s || full;
  const detail = detailWithoutRepeatedName(name, full);
  return { name, full: detail };
}

function firstNonIngredientStepId(nodes: RecipeNode[]): string | null {
  const stepTypes = new Set(["prep", "cook", "wait", "assemble", "serve"]);
  for (const n of nodes) {
    if (stepTypes.has(n.type)) return n.id;
  }
  return null;
}

/**
 * Align ingredient nodes with the Ingredients section lines in `recipeText` (same order).
 * Ensures duplicate ingredients stay separate rows with shared labels but distinct detail lines.
 * When the recipe lists more lines than the parser emitted nodes, injects missing ingredient nodes and `uses` edges.
 */
export function syncIngredientNodesWithSourceLines(graph: RecipeGraph, recipeText: string): RecipeGraph {
  const src = extractIngredientLines(recipeText);
  if (!src.length) return collapseTrivialStepHeadingNodes(graph);

  const ingPositions: number[] = [];
  graph.nodes.forEach((n, idx) => {
    if (n.type === "ingredient") ingPositions.push(idx);
  });
  if (!ingPositions.length) return collapseTrivialStepHeadingNodes(graph);

  const byId = new Map(graph.nodes.map((n) => [n.id, { ...n }]));
  let edges = [...graph.edges];

  for (let i = 0; i < ingPositions.length && i < src.length; i++) {
    const nodeId = graph.nodes[ingPositions[i]!]!.id;
    const node = byId.get(nodeId);
    if (!node) continue;
    const { name, full } = deriveNameFromLine(src[i]!);
    const nextLabel = (name || full).slice(0, 120);
    const nextDetail = full.slice(0, 500);
    byId.set(nodeId, {
      ...node,
      label: nextLabel,
      detail: nextDetail,
    });
  }

  let nodes = graph.nodes.map((n) => byId.get(n.id) ?? n);

  if (src.length > ingPositions.length) {
    const templateId = graph.nodes[ingPositions[ingPositions.length - 1]!]!.id;
    const fromTemplate = edges.filter((e) => e.type === "uses" && e.source === templateId);
    let useTargets = [...new Set(fromTemplate.map((e) => e.target))];
    if (!useTargets.length) {
      const fs = firstNonIngredientStepId(nodes);
      if (fs) useTargets = [fs];
    }

    const extraLines = src.slice(ingPositions.length);
    const existingIds = new Set(nodes.map((n) => n.id));
    let seq = 1;
    while (existingIds.has(`i${seq}`)) seq++;

    const newNodes: RecipeNode[] = [];
    const newEdges: RecipeEdge[] = [];

    for (const line of extraLines) {
      let id = `i${seq}`;
      while (existingIds.has(id)) {
        seq++;
        id = `i${seq}`;
      }
      existingIds.add(id);
      const { name, full } = deriveNameFromLine(line);
      newNodes.push({
        id,
        type: "ingredient",
        label: (name || full).slice(0, 120),
        detail: full.slice(0, 500),
        emoji: "🥗",
        lane: null,
        timeMinutes: null,
        ingredientIds: [],
      });
      for (const t of useTargets) {
        newEdges.push({ source: id, target: t, type: "uses" });
      }
      seq++;
    }

    const firstStepIdx = nodes.findIndex((n) => n.type !== "ingredient");
    if (firstStepIdx >= 0) {
      nodes = [...nodes.slice(0, firstStepIdx), ...newNodes, ...nodes.slice(firstStepIdx)];
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

/** Sort ingredient nodes in numeric id order (e.g. `i1`, `i2`, …) to align with parsed ingredient lines. */
function sortIngredientNodes(nodes: RecipeNode[]): RecipeNode[] {
  const parseNum = (id: string): number => {
    const m = id.match(/\d+/);
    return m ? Number(m[0]) : Number.POSITIVE_INFINITY;
  };
  return [...nodes].sort((a, b) => parseNum(a.id) - parseNum(b.id));
}

/**
 * Patch ingredient nodes when an LLM produced “measure-only” labels by aligning them to parsed ingredient lines.
 *
 * Preserves graph shape, updates only low-signal ingredient labels/details, and finally collapses trivial “Step N”
 * headings so the result is easier to render.
 */
export function repairIngredientNodesFromRecipeText(
  graph: RecipeGraph,
  recipeText: string,
): RecipeGraph {
  const src = extractIngredientLines(recipeText);
  if (!src.length) return collapseTrivialStepHeadingNodes(graph);

  const ingredientNodes = graph.nodes.filter((n) => n.type === "ingredient");
  if (!ingredientNodes.length) return collapseTrivialStepHeadingNodes(graph);

  const orderedNodes = sortIngredientNodes(ingredientNodes);

  const byId = new Map<string, RecipeNode>();
  for (const n of graph.nodes) byId.set(n.id, n);

  for (let i = 0; i < orderedNodes.length && i < src.length; i++) {
    const node = orderedNodes[i];
    const currentLabel = String(node.label ?? "").trim();
    if (!looksLikeJustMeasure(currentLabel)) continue;

    const { name, full } = deriveNameFromLine(src[i]);
    const nextLabel = name.slice(0, 120);
    const nextDetail = full.slice(0, 240);
    byId.set(node.id, {
      ...node,
      label: nextLabel,
      detail: nextDetail,
    });
  }

  return collapseTrivialStepHeadingNodes({
    ...graph,
    nodes: graph.nodes.map((n) => byId.get(n.id) ?? n),
  });
}

