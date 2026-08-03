// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, render, screen } from '@testing-library/react'
import { QR_STATUS, QR_TIMING } from '@music-together/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QrLoginDialog } from './QrLoginDialog'

const qrData = {
  key: 'qrsig-test',
  qrimg: 'data:image/png;base64,test',
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof QrLoginDialog>> = {}) {
  const props: React.ComponentProps<typeof QrLoginDialog> = {
    open: true,
    onOpenChange: vi.fn(),
    platform: 'tencent',
    qrData,
    qrStatus: { status: QR_STATUS.WAITING_SCAN, message: '等待扫码' },
    isLoading: false,
    onRefresh: vi.fn(),
    onCheckStatus: vi.fn(),
    ...overrides,
  }

  return { props, ...render(<QrLoginDialog {...props} />) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('QrLoginDialog polling', () => {
  it('checks immediately and continues at the configured interval', () => {
    vi.useFakeTimers()
    const onCheckStatus = vi.fn()
    renderDialog({ onCheckStatus })

    expect(onCheckStatus).toHaveBeenCalledTimes(1)
    expect(onCheckStatus).toHaveBeenLastCalledWith(qrData.key)

    act(() => {
      vi.advanceTimersByTime(QR_TIMING.POLL_INTERVAL_MS * 2)
    })
    expect(onCheckStatus).toHaveBeenCalledTimes(3)
  })

  it('does not reset polling when the callback identity changes', () => {
    vi.useFakeTimers()
    const firstCallback = vi.fn()
    const { rerender, props } = renderDialog({ onCheckStatus: firstCallback })
    const secondCallback = vi.fn()

    rerender(<QrLoginDialog {...props} onCheckStatus={secondCallback} />)
    act(() => {
      vi.advanceTimersByTime(QR_TIMING.POLL_INTERVAL_MS)
    })

    expect(firstCallback).toHaveBeenCalledTimes(1)
    expect(secondCallback).toHaveBeenCalledTimes(1)
  })

  it('stops polling and closes after a successful login', () => {
    vi.useFakeTimers()
    const onCheckStatus = vi.fn()
    const onOpenChange = vi.fn()
    const { rerender, props } = renderDialog({ onCheckStatus, onOpenChange })

    rerender(
      <QrLoginDialog
        {...props}
        qrStatus={{ status: QR_STATUS.SUCCESS, message: '登录成功' }}
      />,
    )

    act(() => {
      vi.advanceTimersByTime(QR_TIMING.POLL_INTERVAL_MS * 2)
    })
    expect(onCheckStatus).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(QR_TIMING.SUCCESS_CLOSE_DELAY_MS)
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByText('登录成功！')).toBeInTheDocument()
  })
})
