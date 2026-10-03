/** Remove only a quiescent owner's captured directory, unlinking junctions rather than following them. */
import { lstat, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Capture private directory identity before it is exposed to a role.
 * @param directory Host-created absolute execution directory.
 * @returns One removal closure; call only after all granted processes have stopped and evidence has transferred.
 */
export async function ownDirectoryCleanup(directory: string): Promise<() => Promise<void>> {
  const root = resolve(directory), original = await lstat(root)
  if (!original.isDirectory() || original.isSymbolicLink() || await realpath(root) !== root) throw new Error('eval-cleanup-root-refused')
  let removed = false
  return async () => {
    if (removed) return
    const current = await lstat(root)
    if (current.dev !== original.dev || current.ino !== original.ino || current.isSymbolicLink()) throw new Error('eval-cleanup-root-changed')
    const remove = async (path: string): Promise<void> => {
      const rel = relative(root, path)
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('eval-cleanup-path-refused')
      const before = await lstat(path)
      if (before.isSymbolicLink() || !before.isDirectory()) { await unlink(path); return }
      if (await realpath(path) !== path) throw new Error('eval-cleanup-path-refused')
      for (const name of await readdir(path)) await remove(join(path, name))
      const after = await lstat(path)
      if (after.dev !== before.dev || after.ino !== before.ino || after.isSymbolicLink()) throw new Error('eval-cleanup-root-changed')
      await rmdir(path)
    }
    await remove(root)
    removed = true
  }
}
