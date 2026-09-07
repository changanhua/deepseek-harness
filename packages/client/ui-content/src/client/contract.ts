/**
 * Injected faces of the two Content library slot entries. The
 * 'conversation.chat.assistant-actions' slot is declared by ui-chat and the
 * shell slots by ui-layout; this package only contributes entries, so no
 * SlotMap merge lives here.
 * @module @changanhua/dsh-client-ui-content/client/contract
 */

import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CaptureOutcome, ContentLibraryView, EditOutcome, MetadataPatch } from './controller.ts'
import type { CaptureTarget } from './capture-target.ts'
import type { NS } from './locales.ts'

/** Injected business face of the library workspace view. */
export interface LibraryInjected {
  hooks: {
    /** The page-wide library store, shared with every capture entry. */
    library: HostObservable<ContentLibraryView>
  }
  /** Re-read status and snapshot behind the current view. */
  refresh: () => void
  /**
   * Open one entry in the detail pane.
   * @param entryId - entry to open, or null to close the pane.
   */
  select: (entryId: string | null) => void
  /** Open the editor seat for one new entry. */
  beginCreate: () => void
  /**
   * Open the editor on one entry, opening a draft for it when needed.
   * @param entryId - entry to edit.
   */
  beginEdit: (entryId: string) => Promise<EditOutcome>
  /** Close the editor seat. */
  closeEditor: () => void
  /** Clear the conflict mark after the user chose a side. */
  clearConflict: () => void
  /**
   * Create one new entry whose first draft holds the text.
   * @param title - draft title.
   * @param body - draft body.
   */
  createEntry: (title: string, body: string) => Promise<EditOutcome>
  /**
   * Save the editor text as the entry draft.
   * @param title - editor-local title.
   * @param body - editor-local body.
   */
  saveDraft: (title: string, body: string) => Promise<EditOutcome>
  /**
   * Commit the editor text as a new immutable version.
   * @param title - editor-local title.
   * @param body - editor-local body.
   */
  commitVersion: (title: string, body: string) => Promise<EditOutcome>
  /**
   * Apply one metadata intent on an entry.
   * @param entryId - entry to change.
   * @param patch - favorite/archive/project-reference intent.
   */
  setMetadata: (entryId: string, patch: MetadataPatch) => Promise<EditOutcome>
}

/** Full props of the library workspace view. */
export type LibraryWorkspaceProps =
  PropsRuntime<'shell.view'>
  & InjectFace<LibraryInjected>
  & PropsLocale<typeof NS>

/** Injected business face of one assistant-message capture entry. */
export interface CaptureInjected {
  hooks: {
    /** The page-wide library store, shared with the workspace. */
    library: HostObservable<ContentLibraryView>
  }
  /**
   * Capture the addressed message into the library.
   * @param target - the resolved capture target of this message.
   */
  capture: (target: CaptureTarget) => Promise<CaptureOutcome>
}

/** Full props of one assistant-message capture entry. */
export type CaptureActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<CaptureInjected>
  & PropsLocale<typeof NS>

/** Props of the persistent sidebar entry. */
export type ContentNavProps = PropsRuntime<'sidebar.modules'> & PropsLocale<typeof NS>
