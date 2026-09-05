/** Owner-private directory creation and verification for file-backed SQLite. */

import { execFile } from 'node:child_process'
import { lstat, mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, parse, resolve } from 'node:path'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

const execFileAsync = promisify(execFile)

const WINDOWS_PRIVATE_PATH_SCRIPT = String.raw`
& {
  $ErrorActionPreference = 'Stop'
  $Target = [Environment]::GetEnvironmentVariable('DSH_STORAGE_PRIVATE_TARGET')
  $Kind = [Environment]::GetEnvironmentVariable('DSH_STORAGE_PRIVATE_KIND')
  $full = [System.IO.Path]::GetFullPath($Target)
  if ($full.StartsWith('\\')) { throw 'private storage rejects UNC paths' }
  $root = [System.IO.Path]::GetPathRoot($full)
  $drive = New-Object System.IO.DriveInfo($root)
  if ($drive.DriveFormat -ne 'NTFS') { throw "private storage requires NTFS, got $($drive.DriveFormat)" }

  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowed = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
  $writeMask = [int64]([System.Security.AccessControl.FileSystemRights]::WriteData -bor
    [System.Security.AccessControl.FileSystemRights]::AppendData -bor
    [System.Security.AccessControl.FileSystemRights]::CreateDirectories -bor
    [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [System.Security.AccessControl.FileSystemRights]::Delete -bor
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership)
  $replacementMask = [int64]([System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [System.Security.AccessControl.FileSystemRights]::Delete -bor
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership)

  function Get-DirectoryAcl([string]$Path) {
    return (New-Object System.IO.DirectoryInfo($Path)).GetAccessControl()
  }
  function Get-FileAcl([string]$Path) {
    return (New-Object System.IO.FileInfo($Path)).GetAccessControl()
  }
  function Assert-NotReparse([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "private storage rejects reparse point: $Path"
    }
  }
  function Rules([System.Security.AccessControl.FileSystemSecurity]$Acl) {
    return $Acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
  }
  function Assert-Ancestor([string]$Path, [bool]$DirectCreationParent) {
    Assert-NotReparse $Path
    $dangerous = if ($DirectCreationParent) { $writeMask } else { $replacementMask }
    foreach ($rule in (Rules (Get-DirectoryAcl $Path))) {
      $sid = $rule.IdentityReference.Value
      if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
          $rule.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::InheritOnly -and
          -not $allowed.Contains($sid) -and
          (([int64]$rule.FileSystemRights -band $dangerous) -ne 0)) {
        throw "private storage ancestor grants write access to $sid"
      }
    }
  }
  function New-PrivateAcl {
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sidText in $allowed) {
      $sid = New-Object System.Security.Principal.SecurityIdentifier($sidText)
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $sid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow)
      [void]$acl.AddAccessRule($rule)
    }
    return $acl
  }
  function Assert-PrivateAcl([System.Security.AccessControl.FileSystemSecurity]$Acl) {
    $owner = $Acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    if (-not $allowed.Contains($owner)) { throw "private storage has untrusted owner $owner" }
    foreach ($rule in (Rules $Acl)) {
      $sid = $rule.IdentityReference.Value
      if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
          $rule.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::InheritOnly -and
          -not $allowed.Contains($sid)) {
        throw "private storage grants access to $sid"
      }
    }
  }

  if ($Kind -eq 'directory') {
    $missing = New-Object System.Collections.Generic.List[string]
    $cursor = $full
    while (-not [System.IO.Directory]::Exists($cursor)) {
      $missing.Insert(0, $cursor)
      $parent = [System.IO.Path]::GetDirectoryName($cursor)
      if ([string]::IsNullOrEmpty($parent) -or $parent -eq $cursor) { throw 'private storage has no existing ancestor' }
      $cursor = $parent
    }
    $ancestor = $cursor
    $direct = $true
    while ($true) {
      Assert-Ancestor $ancestor $direct
      if ($ancestor -eq $root) { break }
      $ancestor = [System.IO.Directory]::GetParent($ancestor).FullName
      $direct = $false
    }
    foreach ($path in $missing) {
      [void][System.IO.Directory]::CreateDirectory($path, (New-PrivateAcl))
      Assert-NotReparse $path
      $createdAcl = Get-DirectoryAcl $path
      if (-not $createdAcl.AreAccessRulesProtected) { throw 'private storage directory ACL is not protected' }
      Assert-PrivateAcl $createdAcl
    }
    Assert-NotReparse $full
    $acl = Get-DirectoryAcl $full
    if (-not $acl.AreAccessRulesProtected) { throw 'private storage directory ACL is not protected' }
    Assert-PrivateAcl $acl
  } elseif ($Kind -eq 'file') {
    if (-not [System.IO.File]::Exists($full)) { throw 'private storage database file is missing' }
    Assert-NotReparse $full
    Assert-PrivateAcl (Get-FileAcl $full)
  } else {
    throw 'invalid private storage path kind'
  }
}
`

/** Build the scrubbed environment for the fixed Windows ACL helper. */
export function privateDirectoryChildEnv(path: string, kind: 'directory' | 'file'): Record<string, string> {
  return {
    ...scrubbedParentEnv(),
    DSH_STORAGE_PRIVATE_TARGET: path,
    DSH_STORAGE_PRIVATE_KIND: kind,
  }
}

async function checkWindowsPath(path: string, kind: 'directory' | 'file'): Promise<void> {
  await execFileAsync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    WINDOWS_PRIVATE_PATH_SCRIPT,
  ], {
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    env: privateDirectoryChildEnv(path, kind),
  })
}

/** Create or verify the database's owner-private parent directory. */
export async function preparePrivateDirectory(databasePath: string): Promise<void> {
  const directory = dirname(databasePath)
  if (process.platform === 'win32') {
    await checkWindowsPath(directory, 'directory')
    return
  }
  const currentUid = process.getuid?.()
  if (currentUid === undefined) throw new Error('private storage cannot resolve the current POSIX uid')
  const absolute = resolve(directory)
  const missing: string[] = []
  let cursor = absolute
  while (true) {
    let info
    try {
      info = await lstat(cursor)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      missing.unshift(cursor)
      const parent = dirname(cursor)
      if (parent === cursor) throw error
      cursor = parent
      continue
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('private storage rejects a symbolic-link or non-directory ancestor')
    }
    break
  }

  while (true) {
    const info = await lstat(cursor)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('private storage rejects a symbolic-link or non-directory ancestor')
    }
    if ((info.mode & 0o022) !== 0) {
      const safeStickyOwner = (info.mode & 0o1000) !== 0 && (info.uid === 0 || info.uid === currentUid)
      if (!safeStickyOwner) throw new Error('private storage rejects an unsafe writable ancestor')
    }
    const parent = dirname(cursor)
    if (cursor === parse(cursor).root || parent === cursor) break
    cursor = parent
  }

  for (const path of missing) {
    try {
      await mkdir(path, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('private storage rejects a symbolic-link or non-directory ancestor')
    }
    if ((info.mode & 0o077) !== 0 || info.uid !== currentUid) {
      throw new Error('private storage directory is not owner-only')
    }
  }

  const info = await lstat(absolute)
  if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0 || info.uid !== currentUid) {
    throw new Error('private storage directory is not owner-only')
  }
}

/** Verify the database file itself after exclusive creation or discovery. */
export async function verifyPrivateDatabaseFile(databasePath: string): Promise<void> {
  const info = await lstat(databasePath)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('private storage database must be a regular file, not a symbolic link')
  }
  if (info.nlink !== 1) throw new Error('private storage rejects a database with hard-link aliases')
  if (process.platform === 'win32') {
    await checkWindowsPath(databasePath, 'file')
    return
  }
  const currentUid = process.getuid?.()
  if ((info.mode & 0o077) !== 0 || (currentUid !== undefined && info.uid !== currentUid)) {
    throw new Error('private storage database is not owner-only')
  }
}
