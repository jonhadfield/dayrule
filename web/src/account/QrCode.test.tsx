import { render, screen } from '@testing-library/react'
import { encode } from 'uqr'
import { describe, expect, it } from 'vitest'
import { QrCode } from './QrCode'

describe('QrCode', () => {
  it('draws one square per dark module, on white', () => {
    const uri = 'otpauth://totp/Dayrule:a@example.com?secret=' + 'A'.repeat(32)
    render(<QrCode text={uri} label="QR code" />)
    const svg = screen.getByRole('img', { name: 'QR code' })
    const qr = encode(uri, { ecc: 'M', border: 2 })
    const dark = qr.data.flat().filter(Boolean).length
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${qr.size} ${qr.size}`)
    expect(
      svg.querySelector('path')!.getAttribute('d')!.match(/M/g),
    ).toHaveLength(dark)
    expect(svg.querySelector('rect')!.getAttribute('fill')).toBe('#fff')
  })
})
