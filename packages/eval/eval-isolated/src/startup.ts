/** Private Node preloader for the isolated dsh --profile process; it is not an application entrypoint. */
import { installWindowsPathAdapter } from './path-adapter.ts'

const mapping: unknown = JSON.parse(process.env.DSH_EVAL_VOLUME_MAP ?? 'null')
if (!mapping || typeof mapping !== 'object' || !('dos' in mapping) || !('nt' in mapping)
  || typeof mapping.dos !== 'string' || typeof mapping.nt !== 'string') throw new Error('eval-volume-unavailable')
installWindowsPathAdapter({ dos: mapping.dos, nt: mapping.nt })
