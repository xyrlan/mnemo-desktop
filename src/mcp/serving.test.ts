import { describe, expect, it, vi } from 'vitest'
import { sayServing } from './serving'

describe('sayServing', () => {
  it('says why the desktop MCP is not available, and stays until dismissed', () => {
    const warn = vi.fn()
    sayServing({ socket: null, unavailable: 'No server on Windows.' }, warn)
    expect(warn).toHaveBeenCalledWith('Desktop MCP not available', {
      id: 'mcp-unavailable',
      description: 'No server on Windows.',
      duration: Infinity,
    })
  })

  it('says nothing where it serves, or once it has been said', () => {
    const warn = vi.fn()
    sayServing({ socket: '/home/u/.mnemo-desktop/mcp.sock', unavailable: null }, warn)
    sayServing({ socket: null, unavailable: null }, warn)
    expect(warn).not.toHaveBeenCalled()
  })
})
