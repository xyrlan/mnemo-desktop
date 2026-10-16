import { describe, expect, it } from 'vitest'
import { AGENT_ENV_VAR, binaryOf, HOME_VAR, kindOf } from './kind'

describe('agent kind', () => {
  it('reads anything but grok as claude, as every older account is', () => {
    expect(kindOf('grok')).toBe('grok')
    expect(kindOf('claude')).toBe('claude')
    expect(kindOf(undefined)).toBe('claude')
    expect(kindOf('codex')).toBe('claude')
  })

  it('names each CLI and the variable that picks its account', () => {
    expect(binaryOf('grok')).toBe('grok')
    expect(HOME_VAR.grok).toBe('GROK_HOME')
    expect(HOME_VAR.claude).toBe('CLAUDE_CONFIG_DIR')
    expect(AGENT_ENV_VAR).toBe('MNEMO_AGENT')
  })
})
