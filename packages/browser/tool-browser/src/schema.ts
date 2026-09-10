import type { ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

const page = { type: 'object', additionalProperties: false, properties: {
  tabId: { type: 'integer', required: true }, frameId: { type: 'integer', required: true },
  documentId: { type: 'string', required: true }, url: { type: 'string', required: true },
} } as const satisfies ValueSchemaSpec
const element = { type: 'object', additionalProperties: false, properties: {
  page: { ...page, required: true }, snapshotId: { type: 'string', required: true }, elementId: { type: 'string', required: true },
} } as const satisfies ValueSchemaSpec
const intent = { type: 'string', required: true, description: 'User-requested purpose. This does not grant permission or change approval policy.' } as const
const elementProperties = { element: { ...element, required: true }, intent } as const

/** The model receives the actual closed action shapes, including immutable snapshot references. */
export const pageActionSchema = { oneOf: [
  { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'navigate', required: true }, page: { ...page, required: true }, url: { type: 'string', required: true } } },
  { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'click', required: true }, ...elementProperties } },
  { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'fill', required: true }, ...elementProperties, value: { type: 'string', required: true } } },
  { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'submit', required: true }, ...elementProperties } },
  ...(['double_click', 'right_click', 'hover'] as const).map(kind => ({ type: 'object' as const, additionalProperties: false as const,
    properties: { kind: { type: 'string' as const, const: kind, required: true as const }, ...elementProperties } })),
  { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'press', required: true }, ...elementProperties,
    key: { type: 'string', required: true, description: 'Puppeteer key or chord, e.g. Enter, Escape, ArrowDown, Control+A.' } } },
  { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'select', required: true }, ...elementProperties,
    values: { type: 'array', required: true, items: { type: 'string' }, description: 'Exact option values for a native select control.' } } },
  { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'check', required: true }, ...elementProperties,
    checked: { type: 'boolean', required: true } } },
  { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'drag', required: true }, ...elementProperties,
    target: { ...element, required: true, description: 'Drop target from the same document snapshot.' } } },
  { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'upload', required: true }, ...elementProperties,
    files: { type: 'array', required: true, items: { type: 'string' }, description: 'Up to 16 absolute local paths explicitly chosen for this task.' } } },
  ...(['back', 'forward', 'reload', 'tab_close', 'tab_focus', 'screenshot'] as const).map(kind => ({ type: 'object' as const,
    additionalProperties: false as const, properties: { kind: { type: 'string' as const, const: kind, required: true as const }, page: { ...page, required: true as const } } })),
  { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'tab_open', required: true }, page: { ...page, required: true },
    url: { type: 'string', required: true } } },
  { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'scroll', required: true }, page: { ...page, required: true }, x: { type: 'integer', required: true }, y: { type: 'integer', required: true } } },
  { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'wait', required: true }, page: { ...page, required: true }, milliseconds: { type: 'integer', required: true, description: 'At most 15000 milliseconds.' } } },
] } as const satisfies ValueSchemaSpec

export const actionResultSchema = { type: 'object', additionalProperties: false, properties: {
  requestId: { type: 'string', required: true }, sessionId: { type: 'string', required: true }, installationId: { type: 'string', required: true },
  outcome: { type: 'string', required: true, enum: ['observed', 'failed', 'cancelled', 'unknown'] },
  delivery: { type: 'string', required: true, enum: ['not-sent', 'sent'] }, reason: { type: 'string' }, value: { type: 'json' },
} } as const satisfies ValueSchemaSpec

export const instancesSchema = { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
  installationId: { type: 'string', required: true }, extensionId: { type: 'string', required: true },
  online: { type: 'boolean', required: true }, grantEpoch: { type: 'integer', required: true },
  origins: { type: 'array', required: true, items: { type: 'string' } },
  scopes: { type: 'array', required: true, items: { type: 'string' } },
} } } as const satisfies ValueSchemaSpec
