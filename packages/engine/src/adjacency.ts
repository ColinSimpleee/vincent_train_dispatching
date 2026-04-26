import type { RailMap, RailNode } from './types'

export interface AdjacencyEntry {
  outgoing: { id: string; fromNode: string; toNode: string }[]
  incoming: { id: string; fromNode: string; toNode: string }[]
}

export type AdjacencyIndex = Map<string, AdjacencyEntry>

/**
 * 构造节点 → 入边/出边索引。结果按边 id 字典序排序，保证可重现。
 * 不缓存、不持有 RailMap 引用，调用方自行决定何时重建。
 */
export function buildAdjacency(map: RailMap): AdjacencyIndex {
  const adj: AdjacencyIndex = new Map()
  for (const edge of Object.values(map.edges)) {
    const ref = { id: edge.id, fromNode: edge.fromNode, toNode: edge.toNode }
    let from = adj.get(edge.fromNode)
    if (!from) {
      from = { outgoing: [], incoming: [] }
      adj.set(edge.fromNode, from)
    }
    from.outgoing.push(ref)
    let to = adj.get(edge.toNode)
    if (!to) {
      to = { outgoing: [], incoming: [] }
      adj.set(edge.toNode, to)
    }
    to.incoming.push(ref)
  }
  for (const entry of adj.values()) {
    entry.outgoing.sort((a, b) => a.id.localeCompare(b.id))
    entry.incoming.sort((a, b) => a.id.localeCompare(b.id))
  }
  return adj
}

/**
 * 解析下一条边。
 * - 列车从 incomingEdge 到达 node：
 *   - 若 incomingEdge 在 node.outgoing 中（即 incomingEdge.fromNode === node.id）
 *     → 列车实际反向行驶，下一条边在 node.incoming 中
 *   - 否则正向到达，下一条边在 node.outgoing 中
 * - 多个候选 + node.type === 'switch' → 用 node.switchState 选第 i 个（取模）
 * - 多个候选 + 非 switch（trailing） → 第一个
 */
export function resolveNextEdge(
  node: RailNode | undefined,
  incomingEdgeId: string,
  adj: AdjacencyIndex,
): string | undefined {
  if (!node) return undefined
  const entry = adj.get(node.id)
  if (!entry) return undefined

  const arrivedAtFromNode = entry.outgoing.some((e) => e.id === incomingEdgeId)
  const candidates = arrivedAtFromNode
    ? entry.incoming.filter((e) => e.id !== incomingEdgeId)
    : entry.outgoing.filter((e) => e.id !== incomingEdgeId)

  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]!.id

  if (node.type === 'switch') {
    const i = (node.switchState ?? 0) % candidates.length
    return candidates[i]!.id
  }
  return candidates[0]!.id
}
