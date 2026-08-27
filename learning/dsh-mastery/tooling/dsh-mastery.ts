#!/usr/bin/env node

import { deriveCapabilityStatuses, deriveUnitStatuses, loadCurriculum, loadEvidence, recommendNext, validateLab } from './runtime.ts'

function usage(): never {
  console.error('Usage: pnpm exec tsx learning/dsh-mastery/tooling/dsh-mastery.ts <check|status|next>')
  process.exit(2)
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (!command) usage()

  if (command === 'check') {
    const issues = await validateLab()
    if (issues.length === 0) {
      console.log('DSH Mastery Lab: check passed')
      return
    }
    for (const issue of issues) {
      const location = issue.path ? ` (${issue.path})` : ''
      console.log(`${issue.severity.toUpperCase()} ${issue.code}${location}: ${issue.message}`)
    }
    if (issues.some(issue => issue.severity === 'error')) process.exitCode = 1
    return
  }

  const curriculum = await loadCurriculum()
  const evidence = await loadEvidence()

  if (command === 'status') {
    const units = [...deriveUnitStatuses(curriculum, evidence).values()]
    const completed = units.filter(unit => unit.complete).length
    console.log(`${curriculum.name}: ${completed}/${units.length} units complete`)
    console.log('')
    for (const status of deriveCapabilityStatuses(curriculum, evidence)) {
      const refs = status.evidenceFiles.length > 0 ? ` [${status.evidenceFiles.join(', ')}]` : ''
      console.log(`${status.capability.padEnd(24)} ${status.state}${refs}`)
    }
    return
  }

  if (command === 'next') {
    const recommendation = recommendNext(curriculum, evidence)
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
