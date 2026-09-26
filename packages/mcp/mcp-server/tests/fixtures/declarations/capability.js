export function describe(options) {
  return {
    name: options.name,
    description: options.description,
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    outputSchema: { type: 'string' },
  }
}
