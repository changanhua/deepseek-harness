// @vitest-environment jsdom
/**
 * Settings component tests for the Work Observatory section. Per client test
 * discipline these render the real component over fixed shape props and
 * callback stubs; CSS classes and render counts are never asserted.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkObservatoryRange } from '@deepseek-ai/dsh-api-remotes/client'
import { WorkObservatorySection } from '../src/client/WorkObservatorySection.tsx'
import type { WorkObservatorySectionProps } from '../src/client/WorkObservatorySection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** A fixed normalized range spanning one full local day. */
function fixtureRange(from: number, to: number): WorkObservatoryRange {
  return {
    from,
    to,
    summary: {
      humanActiveMs: 1_800_000,
      pageVisibleMs: 3_600_000,
      agentRunningMs: 900_000,
      agentSoloMs: 600_000,
      togetherMs: 300_000,
    },
    timeline: {
      humanActive: [{ start: from + 60_000, end: from + 120_000 }],
      pageVisible: [{ start: from, end: from + 3_600_000 }],
      agentRunning: [{ start: from + 120_000, end: from + 180_000 }],
    },
  }
}

/**
 * Render the section over one readRange stub and the English dictionary.
 * @param readRange - the injected range loader.
 * @returns the spy so a test can assert what a request reached.
 */
function renderSection(readRange: WorkObservatorySectionProps['readRange']): ReturnType<typeof vi.fn> {
  const spy = typeof readRange === 'function'
    ? vi.fn(readRange)
    : readRange
  const props = {
    close: () => undefined,
    readRange: spy,
    t: (key: keyof typeof en) => en[key],
  } as unknown as WorkObservatorySectionProps
  render(<WorkObservatorySection {...props} />)
  return spy
}

describe('Work Observatory settings section', () => {
  it('shows loading with aria-busy while the first range is pending', () => {
    renderSection(() => new Promise<never>(() => {}))

    const loading = screen.getByText(en.loading)
    expect(loading.getAttribute('aria-busy')).toBe('true')
  })

  it('renders the five metrics, their labels, and the three timelines after load', async () => {
    renderSection(() => Promise.resolve(fixtureRange(0, 8_640_000)))

    expect(await screen.findByText('30m 0s')).toBeTruthy()   // Human Active
    expect(screen.getByText('1h 0m')).toBeTruthy()           // Page Visible
    expect(screen.getByText('15m 0s')).toBeTruthy()          // Agent Running
    expect(screen.getByText('10m 0s')).toBeTruthy()          // Agent Solo
    expect(screen.getByText('5m 0s')).toBeTruthy()           // Together
    expect(screen.getByText(en.humanActive)).toBeTruthy()
    expect(screen.getByText(en.pageVisible)).toBeTruthy()
    expect(screen.getByText(en.timelineVisible)).toBeTruthy()
    expect(screen.getByText(en.timelineActive)).toBeTruthy()
    expect(screen.getByText(en.timelineRunning)).toBeTruthy()
  })

  it('shows a user-visible error and retries the same date on request', async () => {
    const readRange = renderSection(vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(fixtureRange(0, 8_640_000)))

    expect(await screen.findByText(en.error)).toBeTruthy()
    const retry = screen.getByRole('button', { name: en.retry })

    fireEvent.click(retry)

    expect(await screen.findByText(en.humanActive)).toBeTruthy()
    expect(readRange).toHaveBeenCalledTimes(2)
  })

  it('requests the selected local calendar day as a local-midnight epoch range', async () => {
    const readRange = renderSection(() => Promise.resolve(fixtureRange(0, 8_640_000)))
    await screen.findByText(en.humanActive)

    fireEvent.change(screen.getByLabelText(en.dateLabel), { target: { value: '2026-03-08' } })

    await waitFor(() => {
      expect(readRange).toHaveBeenLastCalledWith(
        new Date(2026, 2, 8).getTime(),
        new Date(2026, 2, 9).getTime(),
      )
    })
  })

  it('shows the step-lifecycle limitation copy without productivity claims', async () => {
    renderSection(() => Promise.resolve(fixtureRange(0, 8_640_000)))
    await screen.findByText(en.humanActive)

    expect(screen.getByText(en.limitation)).toBeTruthy()
    expect(screen.queryByText(/saved time|productivity/i)).toBeNull()
  })
})
