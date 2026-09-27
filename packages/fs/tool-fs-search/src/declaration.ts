/**
 * Pure `glob` declaration for capability discovery. This module shares the
 * same author-facing schema DSL as the executable tool, but imports no
 * subprocess, ripgrep, or Cordis execution code.
 * @module @deepseek-ai/dsh-tool-fs-search/declaration
 */

import {
  parameterSchemaSpecToJsonSchema,
  valueSchemaSpecToJsonSchema,
  type JsonSchemaNode,
  type ParameterSchemaSpec,
  type ValueSchemaSpec,
} from '@deepseek-ai/dsh-tools'

/** Inputs which change the externally visible `glob` declaration. */
export interface GlobDeclarationConfig {
  readonly sampleOverCapGlobResults: boolean
  readonly globMaxResults: number
}

/** The common author-facing parameter DSL used by both discovery and execution. */
export const GLOB_PARAMETERS = {
  pattern: {
    type: 'string',
    required: true,
    description: 'Glob pattern to match file paths against (e.g. "**/*.ts", "src/**/*.test.js"). '
      + 'A pattern with no "/" matches the basename at any depth, so "*" and "*.ts" both search the whole tree; include a separator to anchor the depth.',
  },
  path: { type: 'string', description: 'Directory to search in. Defaults to the session workspace; a relative path resolves against it.' },
} as const satisfies ParameterSchemaSpec

/** The common author-facing canonical-output DSL used by discovery and execution. */
export const GLOB_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    root: { type: 'string', required: true },
    paths: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const satisfies ValueSchemaSpec

/** One externally consumable, execution-free `glob` declaration. */
export interface GlobDeclaration {
  readonly name: string
  readonly description: string
  readonly parameters: JsonSchemaNode
  readonly outputSchema: JsonSchemaNode
}

function declarationConfig(value: unknown): GlobDeclarationConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('glob declaration config must be an object')
  }
  const config = value as Record<string, unknown>
  const sampleOverCapGlobResults = config.sampleOverCapGlobResults
  if (typeof sampleOverCapGlobResults !== 'boolean') {
    throw new TypeError('glob declaration config.sampleOverCapGlobResults must be a boolean')
  }
  const globMaxResults = config.globMaxResults
  if (typeof globMaxResults !== 'number' || !Number.isSafeInteger(globMaxResults) || globMaxResults < 1) {
    throw new TypeError('glob declaration config.globMaxResults must be a positive safe integer')
  }
  return {
    sampleOverCapGlobResults,
    globMaxResults,
  }
}

/**
 * Describe the `glob` public contract without registering or executing it.
 *
 * The result compiles the same DSL objects the native `glob` tool passes to
 * `defineTool`, so discovery cannot silently diverge from its input or output
 * schema.
 *
 * @param config - the two resolved settings that affect the visible contract.
 * @returns the MCP-ready name, description, input schema, and output schema.
 */
export function describe(config: unknown): GlobDeclaration {
  const { sampleOverCapGlobResults, globMaxResults } = declarationConfig(config)
  const overCapDescription = sampleOverCapGlobResults
    ? `a larger result instead returns ${globMaxResults} paths sampled across top-level entries`
    : `a larger result returns the first ${globMaxResults} paths in modification-time order`
  return {
    name: 'glob',
    description: 'Find files whose paths match a glob pattern. Returns matching file paths — never directories — '
      + 'including hidden and ignored files (VCS metadata directories are excluded). '
      + `Up to ${globMaxResults} paths come back in modification-time order; ${overCapDescription}, `
      + 'says so, and reports where the complete sorted list was saved. This tool does not enumerate directory entries.',
    parameters: parameterSchemaSpecToJsonSchema(GLOB_PARAMETERS),
    outputSchema: valueSchemaSpecToJsonSchema(GLOB_OUTPUT_SCHEMA),
  }
}
