/** Pure observation blockers shared by the sidebar and offline domain owner. */
export function sbcObservationBlockers(input: {
  readonly probe?: { readonly supported?: boolean; readonly loginRequired?: boolean; readonly taskType?: string }
  readonly inventoryCoverage: string
}): string[]
