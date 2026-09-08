import { acquireMemoryOwnership } from '../../src/ownership.ts'

try {
  const ownership = await acquireMemoryOwnership(process.argv[2]!)
  await ownership.release()
  process.stdout.write(JSON.stringify({ acquired: true }))
} catch (error) {
  process.stdout.write(JSON.stringify({ acquired: false, code: (error as { code?: string }).code }))
}
