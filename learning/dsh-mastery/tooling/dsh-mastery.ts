#!/usr/bin/env node

import { deriveCapabilityStatuses, deriveUnitStatuses, loadCurriculum, loadEvidence, recommendNext, validateLab } from './runtime.ts'

function usage(): never {
  console.error('Usage: pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts <check|status|next> [--json]')
  process.exit(2)
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const command = args.find(arg => !arg.startsWith('--'))
  if (!command) usage()

  if (command === 'check') {
    const issues = await validateLab()
    if (json) {
      printJson({ ok: !issues.some(issue => issue.severity === 'error'), issues })
    } else if (issues.length === 0) {
      console.log('DSH Mastery Lab: check passed')
    } else {
      for (const issue of issues) {
        const location = issue.path ? ` (${issue.path})` : ''
        console.log(`${issue.severity.toUpperCase()} ${issue.code}${location}: ${issue.message}`)
      }
    }
    if (issues.some(issue => issue.severity === 'error')) process.exitCode = 1
    return
  }

  const curriculum = await loadCurriculum()
  const evidence = await loadEvidence()

  if (command === 'status') {
    const units = [...deriveUnitStatuses(curriculum, evidence).values()]
    const capabilities = deriveCapabilityStatuses(curriculum, evidence)
    const completed = units.filter(unit => unit.complete).length
    if (json) {
      printJson({
        name: curriculum.name,
        targetLevel: curriculum.target_level,
        completedUnits: completed,
        totalUnits: units.length,
        units: units.map(status => ({
          id: status.unit.id,
          type: status.unit.type,
          path: status.unit.path,
          complete: status.complete,
          attempts: status.attempts,
          evidenceItems: status.evidenceItems,
        })),
        capabilities,
      })
      return
    }
    console.log(`${curriculum.name}: ${completed}/${units.length} units complete`)
    console.log('')
    for (const status of capabilities) {
      const refs = status.evidenceFiles.length > 0 ? ` [${status.evidenceFiles.join(', ')}]` : ''
      console.log(`${status.capability.padEnd(24)} ${status.state}${refs}`)
    }
    return
  }

  if (command === 'next') {
    const recommendation = recommendNext(curriculum, evidence)
    if (json) {
      printJson(recommendation === undefined
        ? { defaultPathComplete: true, recommendation: null }
        : {
            defaultPathComplete: false,
            recommendation: {
              id: recommendation.unit.id,
              type: recommendation.unit.type,
              path: recommendation.unit.path,
              trains: recommendation.unit.trains,
              prerequisites: recommendation.unit.prerequisites,
              reason: recommendation.reason,
              unmetEvidence: recommendation.unmetEvidence,
            },
          })
      return
    }
    if (!recommendation) {
      console.log('No incomplete unit remains on the configured default path.')
      return
    }
    console.log(`${recommendation.unit.id} -> ${recommendation.unit.path}`)
    console.log(`reason: ${recommendation.reason}`)
    if (recommendation.unmetEvidence.length > 0) {
      console.log(`evidence needed: ${recommendation.unmetEvidence.join(', ')}`)
    }
    return
  }

  usage()
}

await main()
