import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
writeFileSync(join(process.cwd(), 'operation-pids.json'), `${JSON.stringify({ parentPid: process.pid, childPid: child.pid })}\n`)
process.stdout.write(`OPERATION-RUN-WAIT-CHILD=${child.pid}\n`)
setInterval(() => {}, 1000)
