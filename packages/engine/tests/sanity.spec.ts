import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION } from '@engine'

describe('engine package wiring', () => {
  it('exports ENGINE_VERSION', () => {
    expect(ENGINE_VERSION).toBe('0.1.0')
  })
})
