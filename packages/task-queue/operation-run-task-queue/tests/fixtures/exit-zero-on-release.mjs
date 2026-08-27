import { existsSync, writeFileSync } from 'node:fs'

const [releasePath, pidPath] = process.argv.slice(2)
if (releasePath === undefined || pidPath === undefined) throw new Error('release and pid paths are required')

writeFileSync(pidPath, `${JSON.stringify({ pid: process.pid })}\n`)
const timer = setInterval(() => {
  if (!existsSync(releasePath)) return
  clearInterval(timer)
  process.exit(0)
}, 5)
