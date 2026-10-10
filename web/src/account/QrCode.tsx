import { useMemo } from 'react'
import { encode } from 'uqr'

/**
 * A QR code drawn as SVG, for an authenticator app to scan. Always dark on
 * white, which is what cameras read best, whatever the theme. (Imported
 * statically: every script must be covered by SRI, which lazy chunks
 * aren't; the encoder is about 4 KB gzipped.)
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { d, size } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 2 })
    let path = ''
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) path += `M${x} ${y}h1v1h-1z`
      }),
    )
    return { d: path, size: qr.size }
  }, [text])
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="size-44 rounded-[6px]"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}
