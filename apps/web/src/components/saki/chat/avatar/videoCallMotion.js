const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t) }
const rest = [0, 0, 0, 1, 1]
const walkDirections = ['left', 'right']
const presentationWalkMs = 2500
const thinkingClips = ['think-chin', 'think-tilt', 'think-nod']
const touchDurations = { head: 1060, bow: 830, 'tail-left': 1150, 'tail-right': 1150, skirt: 2140 }
const restingHand = [0, 0, 0, 1, 0, 0]
const skirtHands = {
  right: [1, 4, -60, .70, 7, .18],
  left: [1, 3, -56, .68, 4, .18],
}

function walkDistance(profile, time) {
  const position = time * (profile.length - 1)
  const index = Math.floor(position)
  return profile[index] + ((profile[index + 1] ?? profile[index]) - profile[index]) * (position - index)
}

export function motionIntent(text) {
  const value = String(text || '')
  if (/靠近一点|走近|靠过来|come closer|step closer|近くに/i.test(value)) return 'closer'
  if (/退后|走远|往后|step back|back up|下がっ/i.test(value)) return 'back'
  if (/走到左|往左走|左边走|walk left|step left|左に歩/i.test(value)) return 'walk-left'
  if (/走到右|往右走|右边走|walk right|step right|右に歩/i.test(value)) return 'walk-right'
  if (/走几步|走两步|走一下|走动|take a walk|walk around|歩いて/i.test(value)) return 'walk'
  if (/(双手|两只手).{0,5}(挥|打招呼)|wave.{0,12}both hands/i.test(value)) return 'wave-both'
  if (/挥手|打个招呼|\bwave\\b|手を振/i.test(value)) return 'wave'
  if (/点点头|点个头|点一下头|\bnod(?: your head)?\b|うなず/i.test(value)) return 'nod'
  if (/摇摇头|摇个头|摇一下头|shake your head|首を振/i.test(value)) return 'shake'
  if (/往左看|向左看|看左边|look (?:to the )?left|左を見/i.test(value)) return 'look-left'
  if (/往右看|向右看|看右边|look (?:to the )?right|右を見/i.test(value)) return 'look-right'
  if (/眨一只眼|眨单眼|单眼眨|\bwink\b|ウインク/i.test(value)) return 'wink'
  if (/歪个头|歪歪头|歪一下头|tilt your head|首をかしげ/i.test(value)) return 'tilt'
  return null
}

function describeClause(text) {
  if (/真的|太好了|太棒|好开心|哈哈|好耶|great|wonderful|excited|嬉しい|やった/i.test(text))
    return { warmth: .8, energy: .68, pose: 0 }
  if (/别担心|我理解|难过|抱抱|没关系|sorry|understand|大丈夫/i.test(text))
    return { warmth: -.42, energy: .28, pose: -2.6 }
  if (/[？?]|为什么|呢\s*[。！!]/.test(text)) return { warmth: .32, energy: .42, pose: 4.8 }
  return { warmth: .17, energy: .38, pose: 0 }
}

export function createVideoCallMotion({ random = Math.random } = {}) {
  let prevTime, blinkAt = 1600, nodAt = -Infinity
  let clause = { warmth: .16, energy: .35, pose: 0 }, cue = null, travel = null, emphasis = null, acknowledgement = 0
  let x = 0, scale = .96, mouth = 0, energy = 0, origin = null, lastPhase = ''
  let stageSide = 0, stageTarget = null, stageHome = null
  const stageWalk = new Map()
  let warmth = .14, clauseTilt = 0
  let pointer = null, glanceX = 0, glanceY = 0, reaction = null
  let thought = null, lastThought = null, nextThoughtAt = 0, lastThinkingTurn
  const reactionClips = new Map()
  const gestures = createConversationGestures(random)
  const blink = t => t >= 0 && t < 156 ? Math.sin(Math.PI * t / 156) ** .82 : 0

  function react(text) {
    clause = describeClause(text)
    gestures.phrase(text)
  }
  function command(text) { cue = motionIntent(text); return cue }
  function pointerLook(x, y) {
    if (reaction?.clip) reaction = null
    pointer = { x: clamp(x, -1, 1), y: clamp(y, -1, 1), until: Infinity }
  }
  function releasePointer(cancelled = false) {
    if (cancelled) pointer = null
    else if (pointer) pointer.until = (prevTime ?? 0) + 620
  }
  function touch(region, side = 1) {
    if (!Object.hasOwn(touchDurations, region) || travel || stageTarget || reaction?.region === region) return
    pointer = null
    const clip = lastPhase !== 'speaking' && reactionClips.get(region)
    reaction = { region, side, start: prevTime ?? 0, clip }
  }
  function loadReactionClips(durations) {
    for (const name of ['head', 'skirt', ...thinkingClips]) {
      const duration = durations?.[name]
      if (Number.isFinite(duration) && duration >= 700 && duration <= 3200) reactionClips.set(name, duration)
    }
  }
  function loadWalkProfiles(profiles) {
    for (const direction of walkDirections) {
      const profile = profiles?.[direction]
      if (!Array.isArray(profile) || profile.length < 12 || profile.length > 160 ||
          profile[0] !== 0 || profile.at(-1) !== 1 ||
          profile.some((point, i) => !Number.isFinite(point) || point < (profile[i - 1] ?? 0) || point > 1)) continue
      stageWalk.set(direction, profile)
    }
  }
  function present(side) {
    // 'center' is an active presentation layout; numeric 0 closes it.
    const nextSide = side === 'center' ? 'center' : Math.sign(Number(side) || 0)
    if (nextSide === stageSide) return
    if (nextSide && !stageSide) stageHome ??= { x, scale }
    stageSide = nextSide
    stageTarget = nextSide ? { x: nextSide === 'center' ? 0 : nextSide * .25, scale: .96 } : (stageHome || { x: 0, scale: .96 })
  }
  function tick(time, { phase = 'idle', turnId, voice = 0, articulation = 0, heard = false } = {}) {
    origin ??= time
    const now = time - origin
    const dt = prevTime == null ? 16 : clamp(now - prevTime, 0, 80)
    prevTime = now
    const ease = (current, target, ms) => current + (target - current) * (1 - Math.exp(-dt / ms))
    const speaking = phase === 'speaking'
    const thinking = phase === 'thinking'
    // Finish a generated turn and regain the frontal pose before redirecting it.
    if (stageTarget !== null && !travel?.clip) {
      const distance = Math.abs(stageTarget.x - x)
      const clip = stageTarget.x < x ? 'left' : 'right'
      const profile = distance > .075 ? stageWalk.get(clip) : null
      travel = distance > .0001 || Math.abs(scale - stageTarget.scale) > .0001
        ? {
            at: now, x, scale, nextX: stageTarget.x, nextScale: stageTarget.scale, stage: true,
            duration: profile ? presentationWalkMs : Math.max(540, 600 + distance * 3400),
            ...(profile && { clip, profile }),
          }
        : null
      stageTarget = null
      if (!stageSide && !travel) stageHome = null
    }
    if (thinking && (lastPhase !== phase || lastThinkingTurn !== turnId)) {
      thought = null
      lastThinkingTurn = turnId
      nodAt = now - 25
      nextThoughtAt = now + 240
    } else if (!thinking) {
      thought = null
    }
    lastPhase = phase
    if (heard && phase === 'listening' && now > acknowledgement) {
      nodAt = now
      acknowledgement = now + 2500 + random() * 800
    }
    if (cue) {
      if (cue === 'wave' || cue === 'wave-both') {
        gestures.wave(cue)
      } else if (!stageSide && !travel?.stage && (cue === 'closer' || cue === 'back' || cue.startsWith('walk'))) {
        const offset = cue === 'walk-left' ? -.10 : cue === 'walk-right' ? .10 : cue === 'walk' ? (x < 0 ? .12 : -.12) : 0
        travel = { at: now, x, scale, nextX: clamp(x + offset, -.15, .15),
          nextScale: clamp(scale + (cue === 'closer' ? .092 : cue === 'back' ? -.092 : 0), .75, 1.12) }
      } else if (cue === 'nod') nodAt = now
      else if (['shake','look-left','look-right','wink','tilt'].includes(cue)) emphasis = { type: cue, start: now }
      cue = null
    }
    if (now > blinkAt + 200) blinkAt = now + 2400 + random() * 2100
    const eyes = 1 - blink(now - blinkAt)
    const sample = speaking ? clamp(voice, 0, 1) : 0
    energy = ease(energy, sample, sample > energy ? 57 : 145)
    mouth = ease(mouth, speaking ? clamp(sample * .86 + articulation * .16, 0, .88) : 0, 43)
    const arms = gestures.tick(now, {
      speaking, listening: phase === 'listening', heard, voice: sample, energy, walking: Boolean(travel), stageSide, dt,
    })
    const nod = now - nodAt
    const headNod = nod >= 0 && nod < 520 ? Math.sin(Math.PI * nod / 520) * 5 : 0
    const envelope = speaking ? energy * (.7 + clause.energy * .6) : .10
    const thinkGaze = thinking ? Math.sin(now / 3100) * .36 : 0
    warmth = ease(warmth, speaking ? clause.warmth : .14, 220)
    clauseTilt = ease(clauseTilt, speaking ? clause.pose : 0, 300)
    let extraYaw = 0, extraRoll = 0, wink = 0, extraGaze = 0
    if (emphasis) {
      const t = clamp((now - emphasis.start) / 1230, 0, 1)
      const amount = smooth(Math.min(t * 5, (1 - t) * 3))
      if (emphasis.type === 'shake') extraYaw = Math.sin(t * 4 * Math.PI) * 12 * amount
      else if (emphasis.type === 'tilt') extraRoll = 9 * amount
      else if (emphasis.type === 'wink') wink = blink(now - emphasis.start - 90)
      else {
        const direction = emphasis.type === 'look-left' ? -1 : 1
        extraGaze = direction * .36 * amount
        extraYaw = direction * 14 * amount
      }
      if (t === 1) emphasis = null
    }
    const face = [
      clamp(extraYaw + Math.sin(now / 3410) * 2.6 + thinkGaze * 16 + arms.emphasis * 2.6, -25, 25),
      clamp(Math.sin(now / 2200) * .9 - headNod + (speaking ? envelope * Math.sin(now / 170) * 1.6 : 0), -25, 25),
      clamp(Math.sin(now / 3540 + .6) * 2.4 + warmth * 3 + clauseTilt + extraRoll, -13, 13),
      clamp(eyes * (1 - wink) * (1 - Math.max(0, warmth) * envelope * .24), 0, 1),
      clamp(eyes * (1 - Math.max(0, warmth) * envelope * .19), 0, 1),
      clamp(extraGaze, -1, 1),
      0,
      mouth,
    ]
    const result = { face, hands: arms.hands, legs: [rest, rest], x, y: Math.sin(now / 970) * 1.1, scale, lean: 0, presented: Boolean(stageSide && !travel && !stageTarget) }
    if (pointer && now > pointer.until) pointer = null
    const looking = !travel && pointer
    glanceX = ease(glanceX, looking ? pointer.x : 0, looking ? 82 : 160)
    glanceY = ease(glanceY, looking ? pointer.y : 0, looking ? 82 : 160)
    if (!travel && (Math.abs(glanceX) > .008 || Math.abs(glanceY) > .008)) {
      face[0] = clamp(face[0] + glanceX * 15, -25, 25)
      face[1] = clamp(face[1] - glanceY * 12, -25, 25)
      face[5] = clamp(face[5] + glanceX * .77, -1, 1)
      face[6] = clamp(glanceY * .7, -1, 1)
    }
    if (reaction && (travel || (reaction.clip && speaking))) reaction = null
    if (reaction?.clip) {
      const progress = (now - reaction.start) / reaction.clip
      if (progress < 1) result.reaction = { name: reaction.region, progress }
      else reaction = null
    } else if (reaction) {
      const { region, side, start } = reaction
      const elapsed = now - start
      const remaining = touchDurations[region] - elapsed
      const amount = smooth(elapsed / 210) * smooth(remaining / 380)
      if (remaining <= 0) reaction = null
      else if (region === 'head') {
        face[1] += amount * 5.2
        face[2] += amount * side * 5.1
        face[3] *= 1 - amount * .91
        face[4] *= 1 - amount * .91
        result.y += amount * 5
      } else if (region === 'bow') {
        face[1] -= amount * 12
        face[6] = amount * .53
        face[2] += amount * side * 3.8
        if (!speaking) face[7] = amount * .20
      } else if (region === 'skirt') {
        const lookAway = smooth((elapsed - 280) / 420) * smooth(remaining / 500)
        face[0] = clamp(face[0] - side * lookAway * 17, -25, 25)
        face[1] -= amount * 5.5
        face[2] = clamp(face[2] - side * amount * 6.5, -13, 13)
        face[5] *= 1 - amount
        face[6] = amount * .23
        face[3] = Math.min(face[3], 1 - .19 * lookAway)
        face[4] = Math.min(face[4], 1 - .11 * lookAway)
        result.pout = lookAway * (speaking ? 0 : 1)
        result.skirtHold = amount
        result.hands = Object.fromEntries(Object.entries(skirtHands).map(([hand, pose]) => {
          const from = arms.hands?.[hand] ?? restingHand
          return [hand, pose.map((value, index) => from[index] + (value - from[index]) * amount)]
        }))
      } else {
        const direction = region === 'tail-left' ? -1 : 1
        face[0] = clamp(face[0] + direction * amount * 9.5, -25, 25)
        face[2] = clamp(face[2] + direction * amount * 5, -13, 13)
        result.tailTouch = [direction, amount * Math.cos(elapsed / 95)]
      }
    }
    if (thinking) {
      if (travel || reaction || pointer || emphasis || arms.hands) {
        if (thought) thought.interrupted = true
        else nextThoughtAt = now + 550
      } else {
        if (!thought && now >= nextThoughtAt) {
          const available = thinkingClips.filter(name => reactionClips.has(name))
          if (available.length) {
            const name = available[(available.indexOf(lastThought) + 1) % available.length]
            thought = { name, start: now, duration: reactionClips.get(name) }
            lastThought = name
          }
        }
        if (thought && !thought.interrupted) {
          const progress = (now - thought.start) / thought.duration
          if (progress < 1) result.reaction = { name: thought.name, progress }
        }
      }
    }
    if (travel) {
      const t = clamp((now - travel.at) / (travel.duration || 1580), 0, 1)
      const speed = Math.sin(Math.PI * t)
      const progress = smooth(t)
      const direction = Math.sign(travel.nextX - travel.x)
      const count = travel.stage ? (Math.abs(travel.nextX - travel.x) > .15 ? 3 : 2) : 2
      const cadence = t * Math.PI * 2 * count
      const root = travel.clip ? walkDistance(travel.profile, t) : progress - Math.sin(cadence * 2) * speed * .019
      x = travel.x + (travel.nextX - travel.x) * root
      scale = travel.scale + (travel.nextScale - travel.scale) * progress
      const stride = Math.sin(cadence)
      result.x = x; result.scale = scale
      result.y += (Math.cos(cadence * 2) * 2 - 3) * speed
      result.lean = direction * speed * (2.9 + stride * .9)
      result.face[0] = clamp(result.face[0] + direction * speed * 12, -25, 25)
      result.legs = [1, -1].map(sign => {
        const lift = Math.max(0, stride * sign) * speed
        // The rig bends each knee inward with opposite signs. Keep that
        // articulation even when walking only toward or away from the camera.
        const swing = direction * 11 * stride * sign * speed
        return [swing + sign * 8 * lift, -sign * 31 * lift, sign * 13 * lift, 1 - .15 * lift, 1 - .07 * lift]
      })
      if (travel.clip) result.walk = { direction: travel.clip, progress: t }
      if (t === 1) {
        result.x = x = travel.nextX
        result.scale = scale = travel.nextScale
        result.legs = [rest, rest]
        travel = null
        if (!stageSide && !stageTarget) stageHome = null
        result.presented = Boolean(stageSide && !stageTarget)
      }
    }
    return result
  }
  return { tick, react, command, present, loadWalkProfiles, loadReactionClips, pointerLook, releasePointer, touch }
}
import { createConversationGestures } from './videoCallGestures.js'
