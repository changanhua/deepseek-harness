import type { CaptureFcReality } from '../src/index.ts'
/** Synthetic, credential-free facts in the existing MAIN read/page-probe wire formats. */
export function fixture(): CaptureFcReality {
  const url = 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/'
  const capturedAt = '2026-09-30T00:00:00.000Z'
  return { requestId: 'capture-one', page: { tabId: 3, frameId: 0, documentId: 'fixture-document', url },
    expiresAt: '2026-10-02T00:00:00.000Z', sourceRefs: [{ kind: 'fixture-observation', id: 'fixture-one', provider: 'fc-read' }],
    read: { schemaVersion: 1, kind: 'fc-sbc-main-read', url, capturedAt, platform: 'pc', status: 'complete', issues: [],
      group: { status: 'complete', selectedSetId: 'fixture-group', sets: [{ setId: 'fixture-group', title: 'Fixture group', challenges: [
        { challengeId: 'challenge-one', title: 'Fixture challenge', completed: false,
          requirements: { status: 'complete', slotCount: 2, constraints: [{ type: 'quality-count', quality: 'gold', minimum: 2 }] },
          rewards: [{ name: 'Fixture reward' }] },
      ] }] },
      inventory: { coverage: 'complete', club: { status: 'complete', pageCount: 1, retrievedAll: true },
        sbcStorage: { status: 'complete', pageCount: 1, retrievedAll: true },
        cards: ['one', 'two', 'three'].map(instanceId => ({ instanceId, cardVersionId: `version-${instanceId}`, source: 'club',
          locked: false, tradeable: false,
          rating: 76, quality: 'gold', nationId: 'n', leagueId: 'l', clubId: 'c', reserveValue: 0 })) } },
    probe: { url, capturedAt, supported: true, taskType: 'puzzle', view: { kind: 'sbc-group',
      selectedChallenge: { title: 'Fixture challenge', visibleIndex: 0 } },
    challengeSet: { title: 'Fixture group', visibleChallengeCount: 1, challenges: [{ title: 'Fixture challenge', completed: false,
      requirementLines: ['Two gold cards'], rewardLines: ['Fixture reward'] }] },
    inventory: { coverage: 'visible-only', visibleCards: [], sbcStorageVisible: true }, marketAccess: { status: 'unknown' } },
  }
}
