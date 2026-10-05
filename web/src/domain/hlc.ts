// Hybrid logical clock (PLAN.md §11.2). Timestamps are fixed-width strings,
// so plain string comparison orders them: wall time, then a counter for
// events in the same millisecond, then the device id as a tie-break.

export type HlcStamp = string

const pad = (n: number, w: number) => n.toString(36).padStart(w, '0')

export class Hlc {
  private wall = 0
  private counter = 0
  private readonly device: string
  private readonly now: () => number

  constructor(device: string, now: () => number = Date.now) {
    if (!/^[a-z0-9]{1,16}$/.test(device))
      throw new Error('device id must be 1-16 [a-z0-9]')
    this.device = device
    this.now = now
  }

  /** A new timestamp, later than any seen so far. */
  tick(): HlcStamp {
    const t = this.now()
    if (t > this.wall) {
      this.wall = t
      this.counter = 0
    } else {
      this.counter++
    }
    return `${pad(this.wall, 9)}-${pad(this.counter, 4)}-${this.device}`
  }

  /** Move past a timestamp from another device, so our next tick is later. */
  observe(stamp: HlcStamp): void {
    const [w, c] = stamp.split('-')
    const wall = parseInt(w ?? '0', 36)
    const counter = parseInt(c ?? '0', 36)
    if (wall > this.wall || (wall === this.wall && counter > this.counter)) {
      this.wall = wall
      this.counter = counter
    }
  }
}

/** A random device id for this tab. */
export function newDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('')
}
