const intervals = { full: 1000 / 30, balanced: 1000 / 24, lite: 1000 / 20 }
const levels = ['lite', 'balanced', 'full']

export function createVideoCallQuality({ compact, cores, memory, saveData, downlink, rtt, startBalanced = false }) {
  const weak = (cores > 0 && cores <= 4) || (memory > 0 && memory <= 4)
  const slowConnection = (downlink > 0 && downlink < 6) || rtt > 220
  const maxCeiling = isCompact => weak || saveData ? 0 : isCompact ? 1 : 2
  let ceiling = maxCeiling(compact)
  let level = startBalanced ? Math.min(ceiling, 1) : ceiling
  let previous, windowStart, total = 0, late = 0, frames = 0
  let busyWindows = 0, smoothWindows = 0

  function setCompact(nextCompact) {
    const nextCeiling = maxCeiling(nextCompact)
    if (nextCeiling === ceiling) return
    const wasAtCeiling = level === ceiling
    ceiling = nextCeiling
    if (level > ceiling || wasAtCeiling) {
      level = ceiling
      busyWindows = smoothWindows = 0
    }
  }

  function reset() {
    previous = windowStart = undefined
    total = late = frames = busyWindows = smoothWindows = 0
  }

  function sample(now) {
    if (previous !== undefined) {
      const gap = now - previous
      total += Math.min(gap, 120)
      if (gap > 45) late++
      frames++
    }
    previous = now
    windowStart ??= now
    if (now - windowStart >= 1000 && frames) {
      const average = total / frames
      if (average > 27 || late > Math.max(2, frames * .13)) {
        if (++busyWindows >= 2) {
          level = Math.max(0, level - 1)
          busyWindows = 0
        }
        smoothWindows = 0
      } else {
        busyWindows = 0
        if (average < 21 && late === 0) {
          if (++smoothWindows >= 8) {
            level = Math.min(ceiling, level + 1)
            smoothWindows = 0
          }
        } else smoothWindows = 0
      }
      windowStart = now
      total = late = frames = 0
    }
    return levels[level]
  }

  return {
    sample,
    reset,
    setCompact,
    get level() { return levels[level] },
    get interval() { return intervals[levels[level]] },
    get compactAssets() { return ceiling < 2 || slowConnection },
  }
}
