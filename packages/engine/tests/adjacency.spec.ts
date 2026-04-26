import { describe, expect, it } from 'vitest'
import { buildAdjacency, resolveNextEdge } from '@engine/adjacency'
import type { RailMap, RailNode } from '@engine'

function makeMap(): RailMap {
  const node = (
    id: string,
    type: RailNode['type'] = 'connector',
    extra: Partial<RailNode> = {},
  ): RailNode => ({
    id,
    x: 0,
    y: 0,
    type,
    ...extra,
  })
  return {
    nodes: {
      a: node('a'),
      b: node('b', 'switch', { switchState: 0 }),
      c: node('c'),
      d: node('d'),
    },
    edges: {
      e_ab: { id: 'e_ab', fromNode: 'a', toNode: 'b', length: 100, occupiedBy: null },
      e_bc: { id: 'e_bc', fromNode: 'b', toNode: 'c', length: 100, occupiedBy: null },
      e_bd: { id: 'e_bd', fromNode: 'b', toNode: 'd', length: 100, occupiedBy: null },
    },
    platforms: [],
  }
}

describe('buildAdjacency', () => {
  it('每个节点列出 outgoing/incoming 边', () => {
    const adj = buildAdjacency(makeMap())
    expect(
      adj
        .get('b')
        ?.outgoing.map((e) => e.id)
        .sort(),
    ).toEqual(['e_bc', 'e_bd'])
    expect(adj.get('b')?.incoming.map((e) => e.id)).toEqual(['e_ab'])
  })

  it('outgoing/incoming 按 id 排序（决定性）', () => {
    const adj = buildAdjacency(makeMap())
    expect(adj.get('b')?.outgoing.map((e) => e.id)).toEqual(['e_bc', 'e_bd'])
  })
})

describe('resolveNextEdge', () => {
  it('正向到达分岔点 + switchState=0 → 选第一条出边', () => {
    const map = makeMap()
    const adj = buildAdjacency(map)
    const next = resolveNextEdge(map.nodes.b!, 'e_ab', adj)
    expect(next).toBe('e_bc')
  })

  it('switchState=1 → 选第二条出边', () => {
    const map = makeMap()
    map.nodes.b!.switchState = 1
    const adj = buildAdjacency(map)
    const next = resolveNextEdge(map.nodes.b!, 'e_ab', adj)
    expect(next).toBe('e_bd')
  })

  it('反向（trailing）到达：忽略 switchState，取第一个候选', () => {
    const map = makeMap()
    const adj = buildAdjacency(map)
    const next = resolveNextEdge(map.nodes.b!, 'e_bc', adj)
    expect(next).toBe('e_ab')
  })

  it('单一候选无视 switchState', () => {
    const map = makeMap()
    map.nodes.b!.switchState = 99
    const adj = buildAdjacency(map)
    const next = resolveNextEdge(map.nodes.b!, 'e_bc', adj)
    expect(next).toBe('e_ab')
  })

  it('无候选返回 undefined', () => {
    const map: RailMap = {
      nodes: { x: { id: 'x', x: 0, y: 0, type: 'endpoint' } },
      edges: {
        e_xy: { id: 'e_xy', fromNode: 'x', toNode: 'x', length: 1, occupiedBy: null },
      },
      platforms: [],
    }
    const adj = buildAdjacency(map)
    const next = resolveNextEdge(map.nodes.x!, 'e_xy', adj)
    expect(next).toBeUndefined()
  })
})
