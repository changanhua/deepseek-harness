/** Source imports are bundled from the existing extension owner; no browser globals are invoked. */
import { createSbcInventorySnapshot } from '../../../../apps/chrome-extension/src/fc-sbc-inventory-snapshot.js'
import { updateFcSbcPageModel } from '../../../../apps/chrome-extension/src/fc-sbc-page-model.js'
import { generateSbcPuzzleCandidates } from '../../../../apps/chrome-extension/src/fc-sbc-puzzle-solver.js'
import { buildSbcPlanVariants } from '../../../../apps/chrome-extension/src/fc-sbc-core.js'
import { createSbcQuotePreflight } from '../../../../apps/chrome-extension/src/fc-sbc-quote-preflight.js'
import { sbcObservationBlockers } from '../../../../apps/chrome-extension/src/fc-sbc-readiness-facts.js'
import type { InventorySnapshot, PlanVariant, PuzzleCandidates } from './types.ts'
/**
 * Reuse the existing inventory normalizer after owner admission.
 * @param input - Owner-admitted typed projection of the existing extension contract.
 * @returns The existing pure algorithm result, without external effects.
 */
export const inventorySnapshot = (input: unknown): InventorySnapshot =>
  createSbcInventorySnapshot(input as Parameters<typeof createSbcInventorySnapshot>[0]) as unknown as InventorySnapshot
/**
 * Reuse the existing bounded same-document semantic page model.
 * @param input - Owner-admitted typed projection of the existing extension contract.
 * @returns The existing pure algorithm result, without external effects.
 */
export const pageModel = (input: unknown): unknown => updateFcSbcPageModel(null, input as Parameters<typeof updateFcSbcPageModel>[1])
/**
 * Reuse existing puzzle constraints, search bounds and provisional semantics.
 * @param input - Owner-admitted typed projection of the existing extension contract.
 * @returns The existing pure algorithm result, without external effects.
 */
export const puzzleCandidates = (input: unknown): PuzzleCandidates =>
  generateSbcPuzzleCandidates(input as Parameters<typeof generateSbcPuzzleCandidates>[0]) as unknown as PuzzleCandidates
/**
 * Reuse existing cross-challenge instance conflict and non-dominance logic.
 * @param input - Owner-admitted typed projection of the existing extension contract.
 * @returns The existing pure algorithm result, without external effects.
 */
export const planVariants = (input: unknown): PlanVariant[] =>
  buildSbcPlanVariants(input as Parameters<typeof buildSbcPlanVariants>[0]) as unknown as PlanVariant[]
/**
 * Reuse existing quote diagnostics without invoking a quote provider.
 * @param input - Owner-admitted typed projection of the existing extension contract.
 * @returns The existing pure algorithm result, without external effects.
 */
export const quotePreflight = (input: unknown): { status: string; issues: Array<{ code: string }> } =>
  createSbcQuotePreflight(input as Parameters<typeof createSbcQuotePreflight>[0]) as unknown as {
    status: string
    issues: Array<{ code: string }>
  }
/**
 * Reuse pure observation readiness without approval or execution reports.
 * @param input - Owner-admitted typed projection of the existing extension contract.
 * @returns The existing pure algorithm result, without external effects.
 */
export const observationBlockers = (input: { probe?: { supported?: boolean; loginRequired?: boolean; taskType?: string }
  inventoryCoverage: string }): string[] => sbcObservationBlockers(input)
