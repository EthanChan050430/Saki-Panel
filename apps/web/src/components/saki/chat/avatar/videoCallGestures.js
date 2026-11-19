const ease = value => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

// Shoulder turn, elbow bend, forearm projection, wrist rotation and palm opening.
// Values use the local coordinate system of the existing painted arm rig.
const poses = {
  explain: [[19, 112, .86, -13, .88], [8, 44, .78, 12, .48]],
  alternate: [[16, 112, .82, 9, .83], [16, 100, .85, -10, .87]],
  open: [[25, 103, .86, -14, .91], [21, 97, .83, -18, .88]],
  question: [[19, 95, .81, -20, .92], [11, 73, .84, -14, .68]],
  gentle: [[7, 137, .76, 12, .59], [4, 82, .83, 12, .43]],
  present: [[24, 101, .92, -23, .93], [7, 49, .80, 10, .44]],
  acknowledge: [[7, 64, .88, -6, .64], [3, 35, .95, 6, .30]],
  wave: [[25, 137, .88, 4, 1], [12, 65, .93, 0, .43]],
  'wave-both': [[20, 137, .88, 4, 1], [18, 134, .87, -4, 1]],
}
const ordinary = ['explain', 'alternate', 'open', 'explain', 'question']

function phraseStyle(text) {
  if (/表格|这张图|看这里|放到旁边|看这边|这份资料|here on|take a look|こちら/i.test(text)) return 'present'
  if (/首先|其次|分别|另一方面|相比|对比|两种|或者|on the other hand|first|second|まず|次に/i.test(text)) return 'alternate'
  if (/[？?]|为什么|你觉得|你想|would you|どう思/i.test(text)) return 'question'
  if (/太好了|太棒|好开心|好耶|欢迎|哈哈|wonderful|excited|やった/i.test(text)) return 'open'
  if (/别担心|没关系|我理解|难过|谢谢|sorry|thank you|大丈夫/i.test(text)) return 'gentle'
  return null
}

export function createConversationGestures(random) {
  let current = null
  let phrase = null
  let queue = null
  let nextLead = random() < .5 ? 'left' : 'right'
  let ordinaryIndex = 0
  let nextSpeech = 0
  let nextListen = 0
  let listeningSince = null
  let lastVoiced = -Infinity
  let settling = 0

  function start(type, now, stageSide) {
    const lead = type === 'present' && typeof stageSide === 'number' && stageSide
      ? (stageSide < 0 ? 'left' : 'right') : nextLead
    nextLead = lead === 'left' ? 'right' : 'left'
    const duration = type === 'acknowledge' ? 1050
      : type.startsWith('wave') ? 1690
      : type === 'alternate' ? 2280 : 1460 + random() * 270
    current = { type, lead, at: now, duration }
    nextSpeech = now + duration + 95 + random() * 230
  }

  function tick(now, { speaking, listening, heard, voice, energy, walking, stageSide, dt }) {
    if (voice > .065) lastVoiced = now
    listeningSince = listening && heard ? (listeningSince ?? now) : null
    if (current && now - current.at >= current.duration) current = null
    if (!walking && queue && !current) {
      start(queue, now, stageSide)
      queue = null
    } else if (!walking && !current && speaking && voice > .09 && now >= nextSpeech - (phrase ? 200 : 0)) {
      start(phrase || ordinary[ordinaryIndex++ % ordinary.length], now, stageSide)
      phrase = null
    } else if (!walking && !current && listeningSince !== null && now - listeningSince > 240 && now >= nextListen) {
      start('acknowledge', now, stageSide)
      nextListen = now + 3800 + random() * 1900
    }

    if (!current) return { hands: null, emphasis: 0 }
    const { type, lead, at, duration } = current
    const sustaining = type.startsWith('wave') || type === 'acknowledge' || (speaking && now - lastVoiced < 460)
    const goal = !walking && sustaining ? 1 : 0
    settling += (goal - settling) * (1 - Math.exp(-dt / (goal ? 105 : 155)))
    const elapsed = now - at
    const hands = {}
    let emphasis = 0
    for (const [index, side] of [lead, lead === 'left' ? 'right' : 'left'].entries()) {
      if (type === 'wave' && index) continue
      const alternate = type === 'alternate'
      const delay = index ? (alternate ? 430 : 115) : 0
      const end = duration - (index || alternate ? 0 : 130)
      const lift = ease((elapsed - delay) / (index ? 455 : 360)) *
        ease((end - elapsed) / (index ? 475 : 525))
      const leadShift = alternate && !index ? 1 - .47 * ease((elapsed - 760) / 560) : 1
      const support = index && ['explain', 'gentle', 'present', 'acknowledge'].includes(type) ? .77 : 1
      const amount = lift * settling * leadShift * support
      if (amount < .009) continue
      const [upper, bend, reach, wrist, palm] = poses[type][index]
      const accent = type.startsWith('wave')
        ? Math.sin(elapsed / 104 + index * .6) * lift * 10
        : (energy - .24) * (index ? 7 : 13) + Math.sin(elapsed / 285 + index) * 3.5
      hands[side] = [
        amount, upper * amount, (bend + accent) * amount,
        1 + (reach - 1) * amount, (wrist + accent * .75) * amount, palm * ease(amount / .66),
      ]
      emphasis += amount * (side === 'right' ? .7 : -.7)
    }
    return { hands: Object.keys(hands).length ? hands : null, emphasis }
  }

  return {
    tick,
    phrase(text) { phrase = phraseStyle(text) },
    wave(type) { queue = type },
  }
}
