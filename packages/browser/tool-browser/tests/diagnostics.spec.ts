import { describe, expect, it } from 'vitest'
import type { BrowserActionResult } from '@changanhua/dsh-browser'
import { diagnoseBrowserResult } from '../src/diagnostics.ts'

const page = { tabId: 7, frameId: 0, documentId: 'doc', url: 'https://example.test/page' }
const render = { kind:'region_render' as const,page,mountId:'panel',regionRef:'11111111-1111-4111-8111-111111111111' as never,presentation:{ summary:'result' } }
const result = (value: Partial<BrowserActionResult>): BrowserActionResult => ({
  requestId:'request',sessionId:'session' as BrowserActionResult['sessionId'],installationId:'installation',
  outcome:'failed',delivery:'not-sent',...value,
})

describe('browser tool diagnostics',()=>{
  it('classifies a deterministic region-ref rejection with one stable recovery fingerprint',()=>{
    const first=diagnoseBrowserResult(result({ reason:'region_ref_not_current' }),render)
    const second=diagnoseBrowserResult(result({ requestId:'different',reason:'region_ref_not_current' }),render)
    const renamedResource=diagnoseBrowserResult(result({ reason:'region_ref_not_current' }),{ ...render,mountId:'another-panel' })
    const changedTarget=diagnoseBrowserResult(result({ reason:'region_ref_not_current' }),{ ...render,regionRef:'22222222-2222-4222-8222-222222222222' as never })
    expect(first).toMatchObject({ code:'REGION_REF_NOT_CURRENT',category:'precondition',retryable:false,
      requiredNextAction:'refresh-page-map' })
    expect(first?.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(second?.fingerprint).toBe(first?.fingerprint)
    expect(renamedResource?.fingerprint).toBe(first?.fingerprint)
    expect(changedTarget?.fingerprint).not.toBe(first?.fingerprint)
  })
  it('requires status lookup for an unknown effect and never calls it retryable',()=>{
    expect(diagnoseBrowserResult(result({ outcome:'unknown',delivery:'sent',reason:'connection_lost' }),render))
      .toEqual({ code:'OUTCOME_UNKNOWN',category:'unknown',retryable:false,requiredNextAction:'request-status' })
  })
  it('resolves target contention through the earlier request instead of retrying the rejected write',()=>{
    expect(diagnoseBrowserResult(result({ reason:'target_busy' }),render))
      .toEqual({ code:'TARGET_BUSY',category:'precondition',retryable:false,requiredNextAction:'request-status' })
  })
  it('distinguishes a conclusive not-sent transport failure from an observed result',()=>{
    expect(diagnoseBrowserResult(result({ reason:'offline' }),render))
      .toEqual({ code:'NOT_SENT',category:'delivery',retryable:false,requiredNextAction:'new-request-after-precondition' })
    expect(diagnoseBrowserResult(result({ outcome:'observed',delivery:'sent' }),render)).toBeUndefined()
  })
})
