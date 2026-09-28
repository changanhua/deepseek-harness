import { acquirePlanningOwnership } from '../../src/ownership.ts'
const lease = await acquirePlanningOwnership(process.argv[2]!)
process.stdout.write('READY\n')
process.stdin.resume()
process.stdin.once('data', (value) => {
  void release(value)
})

async function release(value: Buffer): Promise<void> {
  if (String(value).trim() !== 'release') return
  await lease.release()
  process.stdout.write('RELEASED\n')
  process.exit(0)
}
