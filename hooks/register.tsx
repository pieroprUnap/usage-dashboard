import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LogLine, Stats } from '../types'

const PANE = 'dashboard'
const EMPTY: Stats = {
  tokens: 0, usd: 0, contextPct: 0, contextTokens: 0, contextWindow: 0,
  toolCalls: 0, startedAt: 0, now: 0, byKind: {}, limits: [], agents: [], seen: {}, seenTick: {}, leaving: [], finished: [], log: [],
  background: [], tasks: [], chats: [], busy: 0, active: {}, lastUsed: {}, current: '',
  turnActive: false, lastActivity: 0, happyUntil: 0, puzzledUntil: 0, puzzledBy: '', pets: 0,
  title: '', cwd: '', model: '', effort: '', mode: '', defaultMode: '',
}
const stats = atom({ plugin: 'usage-dashboard', key: 'stats' } as const, EMPTY)
const frame = atom({ plugin: 'usage-dashboard', key: 'frame' } as const, 0)

// Neutral palette: greys on a dark background; color only on the pet and alerts
const C = {
  bg: '#141414',
  rule: '#2c2c2c',
  label: '#8c8c8c',
  dim: '#5f5f5f',
  text: '#c8c8c8',
  value: '#ececec',
  track: '#2c2c2c',
  fill: '#bdbdbd',
  warn: '#d7af5f',
  bad: '#d75f5f',
  ok: '#87af87',
}

function set($: EngineInterface, change: (s: Stats) => Partial<Stats>) {
  return update($, stats, s => {
    const cur = { ...EMPTY, ...s }
    return { ...cur, ...change(cur) }
  }).catch(() => EMPTY)
}

// ───────────────────────── pet ─────────────────────────

const PET_COLORS: Record<string, string> = {
  a: '#1f7fd0', // antennae
  B: '#2fa8f0', // body
  H: '#7fd0ff', // highlight
  D: '#1a6fb0', // shade
  E: '#0a0a0a', // eyes
  P: '#f08fb0', // cheeks
  // props
  L: '#7a7a7a', // laptop shell
  k: '#4a4a4a', // shadow, text lines
  K: '#101820', // screen
  g: '#87af87', // green code
  y: '#d7af5f', // amber code, moon
  c: '#7fd0ff', // cyan code
  w: '#d8d8d8', // paper, cloud, cursor
  M: '#bdbdbd', // lens rim
  G: '#3a5a7a', // lens glass
  W: '#8a5a2a', // handle
  R: '#a05050', // book cover
  m: '#87af87', // green mini agent
  n: '#d7af5f', // amber mini agent
}

type Eyes = 'open' | 'closed' | 'left' | 'right' | 'happy'
type Antennae = 'up' | 'left' | 'right' | 'droop'

// Every character is one terminal cell painted with a background color.
// Cells are twice as tall as wide, so 14×7 cells read as roughly square.
// Glyphs drawn as text on the panel background: 1 = Z, 2 = z, 3 = ♥, 4 = •
const SPRITE_W = 14
const BLANK = '.'.repeat(SPRITE_W)

const ANTENNAE: Record<Antennae, string[]> = {
  up: ['..a........a..', '...a......a...'],
  left: ['.a........a...', '..a......a....'],
  right: ['...a........a.', '....a......a..'],
  droop: ['..............', '.aa........aa.'],
}

function body(eyes: Eyes): string[] {
  const shift = eyes === 'left' ? -1 : eyes === 'right' ? 1 : 0
  const face = [...'..HBBBBBBBBB..']
  const cheeks = [...'.DBBBBBBBBBBB.']
  const eye = eyes === 'closed' ? 'D' : 'E'
  face[5 + shift] = eye
  face[9 + shift] = eye
  if (eyes === 'happy') {
    cheeks[3] = 'P'
    cheeks[11] = 'P'
  }
  return ['.....BBBB.....', '...HBBBBBBB...', face.join(''), cheeks.join(''), 'DDBBBBBBBBBBBB']
}

type Mood = 'sleeping' | 'idle' | 'thinking' | 'coding' | 'searching' | 'reading' | 'delegating' | 'puzzled' | 'happy'

const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'WebSearch', 'ToolSearch', 'LS'])
const READ_TOOLS = new Set(['Read', 'WebFetch', 'NotebookRead'])

function moodOf(s: Stats): Mood {
  if (s.happyUntil > s.now) return 'happy'
  if (s.puzzledUntil > s.now) return 'puzzled'
  if (s.busy > 0) {
    const t = s.current
    if (READ_TOOLS.has(t) || /read|fetch|get_|docs/i.test(t)) return 'reading'
    if (SEARCH_TOOLS.has(t) || /search|query|find|list|resolve/i.test(t)) return 'searching'
    return 'coding'
  }
  if (s.agents.length > 0) return 'delegating'
  if (s.turnActive) return 'thinking'
  if (s.lastActivity && s.now - s.lastActivity > 90_000) return 'sleeping'
  return 'idle'
}

/** jump phases: crouch, rise, fall crouched, back to normal */
type Pose = 'normal' | 'crouch' | 'up'
const HOP: Pose[] = ['crouch', 'up', 'up', 'crouch']
const hopAt = (f: number, every: number): Pose => HOP[f % every] ?? 'normal'
const SWAY: Antennae[] = ['up', 'right', 'up', 'left']
const sway = (f: number, ticks: number): Antennae => SWAY[Math.floor(f / ticks) % 4]

/**
 * The pet in 8 rows. One tick is 125 ms: jumps spread over several frames
 * (crouch, rise, fall) and the antennae pass through the middle.
 */
function petPixels(mood: Mood, f: number): string[] {
  let eyes: Eyes = 'open'
  let ant: Antennae = 'up'
  let pose: Pose = 'normal'
  const blink = (every: number) => f % every >= every - 2
  switch (mood) {
    case 'sleeping':
      eyes = 'closed'; ant = 'droop'; pose = Math.floor(f / 10) % 2 ? 'crouch' : 'normal'; break
    case 'idle':
      eyes = blink(32) ? 'closed' : 'open'; ant = sway(f, 8); pose = hopAt(f, 48); break
    case 'thinking':
      eyes = blink(40) ? 'closed' : 'right'; ant = sway(f, 5); break
    case 'coding':
      eyes = blink(36) ? 'closed' : 'right'; ant = sway(f, 2); pose = hopAt(f, 16); break
    case 'searching':
      eyes = blink(30) ? 'closed' : 'right'; ant = sway(f, 4); break
    case 'reading':
      eyes = blink(24) ? 'closed' : 'right'; pose = f % 24 === 0 ? 'crouch' : 'normal'; break
    case 'delegating':
      eyes = blink(28) ? 'closed' : 'right'; ant = sway(f, 3); pose = hopAt(f, 20); break
    case 'puzzled':
      eyes = (['left', 'left', 'right', 'right', 'closed'] as Eyes[])[Math.floor(f / 4) % 5]; ant = Math.floor(f / 6) % 2 ? 'left' : 'droop'; break
    case 'happy':
      eyes = 'happy'; ant = sway(f, 2); pose = hopAt(f, 6); break
  }
  const b = body(eyes)
  const a = ANTENNAE[ant]
  if (pose === 'up') return [...a, ...b, BLANK]
  if (pose === 'crouch') return [BLANK, BLANK, ...a, ...b.slice(1)]
  return [BLANK, ...a, ...b]
}

// ── props beside the pet: 14×8 cells on its right

const PROP_H = 8
const grid = () => Array.from({ length: PROP_H }, () => [...BLANK])
function paint(g: string[][], x: number, y: number, rows: string[]) {
  rows.forEach((r, dy) =>
    [...r].forEach((ch, dx) => {
      const gx = x + dx
      const gy = y + dy
      if (ch !== '.' && gy >= 0 && gy < PROP_H && gx >= 0 && gx < SPRITE_W) g[gy][gx] = ch
    }),
  )
}
const toRows = (g: string[][]) => g.map(r => r.join(''))

/** laptop whose code is typed and scrolls line by line */
function laptop(f: number): string[] {
  const g = grid()
  paint(g, 0, 1, ['.LLLLLLLLLLLL.', '.LKKKKKKKKKKL.', '.LKKKKKKKKKKL.', '.LKKKKKKKKKKL.', '.LLLLLLLLLLLL.', 'LkLkLkLkLkLkLL', '.kkkkkkkkkkkk.'])
  const base = Math.floor(f / 6)
  for (let i = 0; i < 3; i++) {
    const n = base + i
    const indent = [0, 2, 4, 2][n % 4]
    const len = Math.min(10 - indent, 3 + ((n * 5) % 5))
    const isTyping = i === 2
    const shown = isTyping ? Math.min(len, (f % 6) + 1) : len
    const color = 'gyc'[n % 3]
    for (let x = 0; x < shown; x++) g[2 + i][2 + indent + x] = x === 0 && n % 4 === 0 ? 'c' : color
    if (isTyping && f % 2 === 0 && 2 + indent + shown < 12) g[2 + i][2 + indent + shown] = 'w'
  }
  return toRows(g)
}

/** magnifier gliding over a document */
function magnifier(f: number): string[] {
  const g = grid()
  paint(g, 3, 0, ['wwwwwwwwww', 'wkkkkkkkkw', 'wwwwwwwwww', 'wkkkkkwwww', 'wwwwwwwwww', 'wkkkkkkkww', 'wwwwwwwwww'])
  const path = [[2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 1], [8, 1], [8, 2], [7, 3], [6, 3], [5, 3], [4, 3], [3, 3], [2, 2], [2, 1]]
  const [x, y] = path[Math.floor(f / 2) % path.length]
  paint(g, x, y, ['.MMM.', 'MGGGM', '.MMM.', '....W', '.....W'])
  return toRows(g)
}

/** open book turning pages */
function book(f: number): string[] {
  const g = grid()
  paint(g, 0, 3, ['..wwwwwRwwwww.', '..wkkkwRwkkkw.', '..wwwwwRwwwww.', '..wkkwwRwkkww.', '.RRRRRRRRRRRR.'])
  const flip = f % 3
  if (flip === 0) paint(g, 8, 2, ['wwww'])
  if (flip === 1) paint(g, 7, 1, ['.ww', 'w..'])
  if (flip === 2) paint(g, 3, 2, ['wwww'])
  return toRows(g)
}

/** thought cloud with dots */
function cloud(f: number): string[] {
  const g = grid()
  paint(g, 1, 0, ['...wwwwww...', '.wwwwwwwwww.', '.wwwwwwwwww.', '...wwwwww...'])
  for (let i = 0; i < f % 4; i++) g[1][4 + i * 2] = 'k'
  paint(g, 1, 5, ['w'])
  paint(g, 0, 6, ['w'])
  return toRows(g)
}

/** rising Zs and a moon */
function snore(f: number): string[] {
  const g = grid()
  paint(g, 10, 0, ['.yy', 'y..', '.yy'])
  g[Math.max(0, 6 - (f % 6))][2] = '1'
  g[Math.max(0, 6 - ((f + 3) % 6))][5] = '2'
  g[Math.max(0, 5 - ((f + 1) % 5))][7] = '1'
  return toRows(g)
}

/** mini agents bouncing while a message travels */
function minis(f: number, count: number): string[] {
  const g = grid()
  const mini = (c: string) => [`.${c}${c}${c}.`, `${c}E${c}E${c}`, `${c}${c}${c}${c}${c}`]
  paint(g, 2, f % 2 ? 4 : 5, mini('m'))
  if (count !== 1) paint(g, 8, f % 2 ? 5 : 4, mini('n'))
  const dot = f % 7
  if (dot < 6) g[2][dot * 2] = '4'
  return toRows(g)
}

/** floating hearts */
function hearts(f: number): string[] {
  const g = grid()
  g[Math.max(0, 6 - (f % 6))][2] = '3'
  g[Math.max(0, 6 - ((f + 2) % 6))][6] = '3'
  g[Math.max(0, 6 - ((f + 4) % 6))][10] = '3'
  return toRows(g)
}

/** question marks popping around the head */
function questions(f: number): string[] {
  const g = grid()
  const spots = [[1, 1], [5, 0], [9, 2], [3, 3], [11, 1]]
  spots.forEach(([x, y], i) => {
    const phase = (f + i * 3) % 10
    if (phase < 6) g[Math.max(0, y + (phase < 3 ? 1 : 0))][x] = i % 2 ? '6' : '5'
  })
  return toRows(g)
}

function prop(mood: Mood, f: number, agents: number): string[] | null {
  const at = (ticks: number) => Math.floor(f / ticks)
  switch (mood) {
    case 'coding': return laptop(at(2))
    case 'searching': return magnifier(f)
    case 'reading': return book(at(3))
    case 'thinking': return cloud(at(4))
    case 'sleeping': return snore(at(4))
    case 'delegating': return minis(at(2), agents)
    case 'puzzled': return questions(at(2))
    case 'happy': return hearts(at(2))
    default: return null
  }
}

function scene(mood: Mood, f: number, agents: number): string[] {
  const pet = petPixels(mood, f)
  const p = prop(mood, f, agents) ?? Array.from({ length: PROP_H }, () => BLANK)
  return pet.map((r, i) => `${r}.${p[i] ?? BLANK}`)
}

const GLYPH: Record<string, [string, string]> = {
  '1': ['Z', '#d8d8d8'],
  '2': ['z', '#a8a8a8'],
  '3': ['♥', '#f08fb0'],
  '4': ['•', '#d8d8d8'],
  '5': ['?', '#d7af5f'],
  '6': ['?', '#8c8c8c'],
}

type Run = [text: string, bg: string | undefined, fg: string | undefined]

/** merges equal adjacent cells into runs */
function runs(line: string): Run[] {
  const out: Run[] = []
  for (const ch of line) {
    const glyph = GLYPH[ch]
    const cell: Run = glyph ? [glyph[0], undefined, glyph[1]] : [' ', PET_COLORS[ch], undefined]
    const last = out[out.length - 1]
    if (last && last[1] === cell[1] && last[2] === cell[2]) last[0] += cell[0]
    else out.push(cell)
  }
  return out
}

function bubble(mood: Mood, s: Stats, f: number): string {
  const dots = '.'.repeat((f % 3) + 1).padEnd(3)
  switch (mood) {
    case 'sleeping': return ['z', 'z Z', 'z Z z'][f % 3]
    case 'thinking': return `hmm${dots}`
    case 'coding': return `⚙ ${s.current}`
    case 'searching': return `⌕ ${s.current}`
    case 'reading': return `▤ ${s.current}`
    case 'delegating': return `${s.agents.length} agent${s.agents.length > 1 ? 's' : ''} in the room`
    case 'puzzled': return `? ${s.puzzledBy} failed`
    case 'happy': return ['♥', '♥ ♥', '♥ ♥ ♥'][f % 3]
    default: return ''
  }
}

// ───────────────────────── room scene ─────────────────────────
//
// The room is an agent map drawn on a grid of terminal cells, over a faint
// dotted floor. `main` is the session's own pet, in the center. Every agent
// is a tiny cousin of the pet (antennae, two rows of shaded body, eyes and
// mouth as glyphs) placed on a grid around `main`, nearest first, with its
// name under it and a dotted link to `main`. Packets travel the links both ways;
// a talking agent shows a speech chip. Agents pop in when they start, bob,
// sway and blink while they work, and burst into sparks when they finish.
// The grid grows rows with the count; past the last row the rest gather as
// a `+N` chip.

type Cell = { ch: string; bg?: string; fg?: string }
type Canvas = Cell[][]

const AGENT_PALETTE = ['#87af87', '#d7af5f', '#af87d7', '#5fafd7', '#d78787', '#87d7d7', '#d7d787', '#afafaf']

function agentColor(type: string): string {
  let h = 0
  for (const ch of type) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AGENT_PALETTE[h % AGENT_PALETTE.length]
}

/** scales a #rrggbb color: < 1 darkens, > 1 lightens */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k)))
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(ch)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

const SPRITE = 5
const INK = '#141414'
const FLOOR = '#262626'
const LINK = '#4a4a4a'

const blankCanvas = (w: number, h: number): Canvas =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: ' ' })))

function put(c: Canvas, x: number, y: number, cell: Cell) {
  const at = c[y]?.[x]
  if (at) Object.assign(at, cell)
}

/** a glyph on the floor; never drawn over a body or a label */
function glyph(c: Canvas, x: number, y: number, ch: string, fg: string, over = false) {
  const cell = c[Math.round(y)]?.[Math.round(x)]
  if (!cell || cell.bg) return
  if (!over && cell.ch !== ' ' && cell.fg !== FLOOR && cell.fg !== LINK) return
  cell.ch = ch
  cell.fg = fg
}

function text(c: Canvas, x: number, y: number, s: string, fg: string) {
  ;[...s].forEach((ch, dx) => glyph(c, x + dx, y, ch, fg, true))
}

type Look = { eyes: string; mouth: string; antennae: [string, string] }

function look(tick: number, i: number, isTalking: boolean): Look {
  const blink = (tick + i * 7) % 48 >= 46
  const antennae = ([['╲', '╱'], ['│', '╱'], ['╲', '╱'], ['╲', '│']] as [string, string][])[Math.floor((tick + i * 3) / 4) % 4]
  return { eyes: blink ? '‿' : '•', mouth: isTalking ? ((tick + i) % 4 < 2 ? 'o' : '‿') : ' ', antennae }
}

/** a tiny slime: antennae row, face row (eyes), body row (mouth) */
function drawSlime(c: Canvas, x: number, y: number, color: string, l: Look) {
  const light = shade(color, 1.35)
  const dark = shade(color, 0.7)
  glyph(c, x + 1, y, l.antennae[0], dark, true)
  glyph(c, x + SPRITE - 2, y, l.antennae[1], dark, true)
  for (let dx = 0; dx < SPRITE; dx++) {
    const isEdge = dx === 0 || dx === SPRITE - 1
    const isEye = dx === 1 || dx === SPRITE - 2
    put(c, x + dx, y + 1, { ch: isEye ? l.eyes : ' ', bg: dx === 0 ? light : color, fg: INK })
    put(c, x + dx, y + 2, { ch: dx === 2 ? l.mouth : ' ', bg: isEdge ? dark : color, fg: INK })
  }
}

/** the pet at map scale: 9×5 cells plus a row to hop into */
function miniPetPixels(mood: Mood, tick: number): string[] {
  const sleepy = mood === 'sleeping'
  const blink = sleepy || tick % 32 >= 30
  const busy = mood === 'coding' || mood === 'delegating' || mood === 'happy'
  const hop = busy ? tick % 12 < 2 : mood === 'idle' && tick % 48 < 2
  const sway = Math.floor(tick / (busy ? 2 : 8)) % 4
  const antennae = sleepy
    ? ['.........', '.aa...aa.']
    : [['.a.....a.', '..a...a..'], ['a.....a..', '.a...a...'], ['.a.....a.', '..a...a..'], ['..a.....a', '...a...a.']][sway]
  const eye = blink ? 'D' : 'E'
  const cheek = mood === 'happy' ? 'P' : 'B'
  const body = ['..HBBBB..', `.HB${eye}BB${eye}B.`, `D${cheek}BBBBB${cheek}D`]
  const blank = '.........'
  return hop ? [...antennae, ...body, blank] : [blank, ...antennae, ...body]
}

/** the session's pet, painted from its pixel rows */
function drawPet(c: Canvas, x: number, y: number, rows: string[]) {
  rows.forEach((r, dy) =>
    [...r].forEach((k, dx) => {
      const bg = PET_COLORS[k]
      if (k !== '.' && bg) put(c, x + dx, y + dy, { ch: ' ', bg })
    }),
  )
}

/** a faint dotted floor, like a map grid */
function drawFloor(c: Canvas) {
  c.forEach((row, y) => row.forEach((cell, x) => {
    if (y % 2 === 0 && x % 4 === 0) {
      cell.ch = '·'
      cell.fg = FLOOR
    }
  }))
}

/** a dotted link between two points */
function drawLink(c: Canvas, from: { x: number; y: number }, to: { x: number; y: number }) {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y) * 2)
  for (let k = 1; k < steps; k += 2) {
    const t = k / steps
    glyph(c, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, '·', LINK)
  }
}

/** a packet flying along a link, with a fading trail */
function drawPacket(c: Canvas, from: { x: number; y: number }, to: { x: number; y: number }, p: number, color: string) {
  for (const [dt, ch, fg] of [[0.12, '·', '#5f5f5f'], [0.06, '•', '#8c8c8c'], [0, '●', color]] as const) {
    const t = p - dt
    if (t < 0 || t > 1) continue
    glyph(c, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, ch, fg)
  }
}

type RoomAgent = { id: string; name: string; type: string; since: number }
type Leaving = { id: string; type: string; tick: number }

const SLOT_W = 9
const SLOT_H = 5
const MIN_ROWS = 4
const MAX_ROWS = 10

type Spot = { x: number; y: number }

/** slot centers around main, nearest first; main's own box stays clear */
function slotsFor(width: number, rows: number) {
  const cols = Math.max(1, Math.floor(width / SLOT_W))
  const height = rows * SLOT_H
  const cx = Math.floor(width / 2)
  const cy = Math.floor(height / 2)
  const spots: Spot[] = []
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = k * SLOT_W + Math.floor(SLOT_W / 2) + Math.floor((width - cols * SLOT_W) / 2)
      const y = r * SLOT_H + 2
      const isMain = Math.abs(x - cx) < 8 && y >= cy - 4 && y <= cy + 6
      if (!isMain) spots.push({ x, y })
    }
  }
  spots.sort((p, q) => Math.hypot((p.x - cx) / 2, p.y - cy) - Math.hypot((q.x - cx) / 2, q.y - cy))
  return { spots, height, cx, cy }
}

function roomScene(
  agents: RoomAgent[],
  leaving: Leaving[],
  seenTick: Record<string, number>,
  talking: Set<string>,
  tick: number,
  width: number,
  pet: string[],
) {
  const fleeting = leaving.filter(l => !agents.some(a => a.id === l.id))
  const everyone = [...agents.map(a => ({ kind: 'agent' as const, a })), ...fleeting.map(l => ({ kind: 'puff' as const, l }))]
  // grow rows until everyone fits (or the room is full)
  let rows = MIN_ROWS
  let layout = slotsFor(width, rows)
  while (layout.spots.length < everyone.length && rows < MAX_ROWS) layout = slotsFor(width, ++rows)
  const { height, cx, cy } = layout
  const capacity = layout.spots.length
  const overflow = Math.max(0, everyone.length - capacity)
  const shown = overflow ? everyone.slice(0, capacity - 1) : everyone
  const spots = layout.spots
  const c = blankCanvas(width, height)
  drawFloor(c)

  const petX = cx - 4
  const petY = cy - 3
  const mainAt = { x: cx, y: cy + 1 }

  // links first, so bodies and labels sit on top of them
  const isCrowded = shown.length > 12
  shown.forEach((entry, i) => {
    const isBusy = entry.kind === 'agent' && (talking.has(entry.a.name) || Math.floor((tick + i * 5) / 16) % 3 === 0)
    if (!isCrowded || isBusy) drawLink(c, mainAt, { x: spots[i].x, y: spots[i].y })
  })
  drawPet(c, petX, petY, pet)
  text(c, cx - 2, petY + pet.length, 'main', '#ececec')

  shown.forEach((entry, i) => {
    const at = spots[i]
    const x = at.x - 2
    const y = at.y - 2
    if (entry.kind === 'puff') {
      const age = tick - entry.l.tick
      const color = agentColor(entry.l.type)
      glyph(c, at.x, at.y, ['✺', '✦', '*', '·'][Math.min(3, Math.floor(age / 3))], color, true)
      if (age < 6) {
        glyph(c, at.x - 2, at.y - 1, '·', color, true)
        glyph(c, at.x + 2, at.y - 1, '·', color, true)
        glyph(c, at.x - 1, at.y + 1, '˙', color, true)
        glyph(c, at.x + 1, at.y + 1, '˙', color, true)
      }
      return
    }
    const { a } = entry
    const color = agentColor(a.type)
    const age = tick - (seenTick[a.id] ?? tick - 99)
    const isTalking = talking.has(a.name) || talking.has(a.type)
    if (age < 2) {
      glyph(c, at.x, at.y, age === 0 ? '·' : '✦', color, true)
      return
    }
    if (age < 4) {
      for (let dx = 1; dx < SPRITE - 1; dx++) put(c, x + dx, y + 2, { ch: ' ', bg: color })
      return
    }
    const bob = (tick + i * 5) % 16 < 2 ? -1 : 0
    drawSlime(c, x, y + bob, color, look(tick, i, isTalking))
    text(c, at.x - Math.floor(Math.min(8, a.name.length) / 2), y + 3, clip(a.name, 8), color)
    if (isTalking) {
      ;[...' … '].forEach((ch, dx) => put(c, x + SPRITE + dx - 1, y - 1 + bob, { ch, bg: '#3a3a3a', fg: '#ececec' }))
    }

    // traffic: talking agents always, the rest in waves; odd agents reply
    const period = 16
    const wave = Math.floor((tick + i * 5) / period) % 3 === 0
    if (isTalking || wave) {
      const p = ((tick + i * 5) % period) / (period - 4)
      if (p <= 1) drawPacket(c, i % 2 ? at : mainAt, i % 2 ? mainAt : at, p, color)
    }
  })

  if (overflow) {
    ;[...` +${overflow + 1} `].forEach((ch, dx) => put(c, width - 8 + dx, height - 2, { ch, bg: '#3a3a3a', fg: '#ececec' }))
  }
  return c
}

/** merges equal adjacent cells into runs of [text, bg, fg] */
function canvasRuns(row: Cell[]): Run[] {
  const out: Run[] = []
  for (const cell of row) {
    const last = out[out.length - 1]
    if (last && last[1] === cell.bg && last[2] === cell.fg) last[0] += cell.ch
    else out.push([cell.ch, cell.bg, cell.fg])
  }
  return out
}

// ───────────────────────── helpers ─────────────────────────

const KINDS: { key: string; label: string }[] = [
  { key: 'builtin', label: 'built-in' },
  { key: 'mcp', label: 'mcp' },
  { key: 'plugin', label: 'plugins' },
  { key: 'agent', label: 'subagents' },
  { key: 'skill', label: 'skills' },
]

function classify(tool: string, input: Record<string, unknown> | undefined): [kind: string, name: string] {
  if (tool === 'Skill') return ['skill', String(input?.skill ?? '?')]
  if (tool === 'Agent' || tool === 'Task') return ['agent', String(input?.subagent_type ?? 'general-purpose')]
  if (tool.startsWith('mcp__plugin_')) {
    const [plugin = '?', ...rest] = tool.slice('mcp__plugin_'.length).split('__')
    return ['plugin', `${plugin.split('_')[0]} › ${rest.join('__') || plugin}`]
  }
  if (tool.startsWith('mcp__')) {
    const [server = '?', ...rest] = tool.slice(5).split('__')
    return ['mcp', `${server.replace(/^claude_ai_/, '')} › ${rest.join('__')}`]
  }
  return ['builtin', tool]
}

const HIDDEN_TOOLS = new Set(['SubagentHandback'])

const shortTool = (tool: string) => (tool.startsWith('mcp__') ? tool.split('__').slice(-1)[0] ?? tool : tool)

const fmtTokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`

function fmtClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

function fmtAgo(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

const LIMIT_LABEL: Record<string, string> = { five_hour: '5 hours', seven_day: 'weekly' }

function fmtReset(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const mins = Math.max(0, Math.round((t - now) / 60000))
  if (mins < 60) return `in ${mins}m`
  if (mins < 48 * 60) return `in ${Math.floor(mins / 60)}h ${mins % 60}m`
  return `in ${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`
}

const MODE_LABEL: Record<string, string> = {
  default: 'manual',
  auto: 'auto',
  acceptEdits: 'accept edits',
  plan: 'plan',
  bypassPermissions: 'bypass',
  dontAsk: "don't ask",
}

const tidyPath = (p: string) => p.replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/, '~').replace(/\\/g, '/')
const clip = (t: string, n: number) => (n <= 1 ? '' : t.length > n ? `${t.slice(0, n - 1)}…` : t)
const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim()

// ───────────────────────── data ─────────────────────────

async function refresh($: EngineInterface) {
  const [usage, now, agentList, cwd, model, envEffort, settings] = await Promise.all([
    $.session.usage(),
    $.clock.now(),
    $.agent.list().catch(() => []),
    $.session.cwd().catch(() => ''),
    $.session.model().catch(() => ''),
    $.env.get('CLAUDE_EFFORT').catch(() => undefined),
    $.settings.read().catch(() => undefined),
  ])
  const tick = await read($, frame)
  await set($, s => {
    const seen = { ...s.seen }
    const seenTick = { ...s.seenTick }
    const agents = agentList
      .filter(a => a.status === 'running')
      .map(a => {
        seen[a.id] ??= now
        seenTick[a.id] ??= tick
        return { id: a.id, name: a.name ?? a.type, type: a.type, description: a.description, parentId: a.parentId, since: seen[a.id] }
      })
    const gone = s.agents.filter(a => !agents.some(b => b.id === a.id)).map(a => ({ id: a.id, type: a.type, tick }))
    const leaving = [...s.leaving, ...gone].filter(l => tick - l.tick < 14)
    const done = s.agents
      .filter(a => !agents.some(b => b.id === a.id))
      .map(a => ({ id: a.id, name: a.name, type: a.type, description: a.description, tookMs: now - a.since, at: now }))
    const finished = [...s.finished, ...done].filter(x => now - x.at < 3 * 60_000).slice(-8)
    const log = done.reduce((acc, x) => [...acc, { at: now, who: x.name, color: agentColor(x.type), text: `done · took ${fmtAgo(x.tookMs)}` }], s.log).slice(-40)
    return {
      seenTick,
      leaving,
      finished,
      log,
      usd: usage.cost?.usd ?? s.usd,
      contextPct: usage.context.percent ?? s.contextPct,
      contextTokens: usage.context.tokens ?? s.contextTokens,
      contextWindow: usage.context.window,
      startedAt: usage.startedAt,
      now,
      limits: usage.rateLimits.length ? usage.rateLimits.map(l => ({ ...l })) : s.limits,
      agents,
      seen,
      cwd: cwd || s.cwd,
      model: model || s.model,
      effort: s.effort || envEffort || '',
      defaultMode: String((settings as { permissions?: { defaultMode?: string } } | undefined)?.permissions?.defaultMode ?? s.defaultMode ?? ''),
      lastActivity: s.lastActivity || now,
    }
  })
}

const pushLog = (s: Stats, line: Omit<LogLine, 'at'>) => [...s.log, { ...line, at: s.now }].slice(-40)

const pushChat = (s: Stats, from: string, to: string, text: string, at: number, kind: 'spawn' | 'message' = 'message') =>
  [...s.chats, { from, to, text: clip(oneLine(text), 120), at, kind }].slice(-8)

/** classic hook inputs carry the turn's effort and the permission mode */
function readTurnInfo($: EngineInterface, e: unknown) {
  const info = e as { effort?: { level?: string }; permission_mode?: string }
  const effort = info.effort?.level
  const mode = info.permission_mode
  if (effort || mode) {
    void set($, s => ({ effort: effort || s.effort, mode: mode || s.mode }))
  }
}

/** a task-notification names the job by its task id or the call that started it */
const finished = (b: { id: string; taskId?: string }, text: string) => text.includes(b.id) || (!!b.taskId && text.includes(b.taskId))

type TaskRow = { id?: string; subject?: string; status?: string; activeForm?: string; content?: string }

function trackTasks($: EngineInterface, tool: string, input: Record<string, unknown> | undefined, result: unknown) {
  const res = (result ?? {}) as { task?: TaskRow; tasks?: TaskRow[] }
  if (tool === 'TaskCreate' && res.task?.id) {
    const task = { id: String(res.task.id), subject: String(input?.subject ?? res.task.subject ?? ''), status: 'pending', activeForm: input?.activeForm as string | undefined }
    void set($, s => ({ tasks: [...s.tasks.filter(x => x.id !== task.id), task] }))
  } else if (tool === 'TaskUpdate' && input?.taskId) {
    const id = String(input.taskId)
    void set($, s => ({
      tasks: input.status === 'deleted'
        ? s.tasks.filter(x => x.id !== id)
        : s.tasks.map(x => (x.id === id
          ? { ...x, status: String(input.status ?? x.status), subject: String(input.subject ?? x.subject), activeForm: (input.activeForm as string | undefined) ?? x.activeForm }
          : x)),
    }))
  } else if (tool === 'TaskList' && Array.isArray(res.tasks)) {
    const fresh = res.tasks.map(x => ({ id: String(x.id), subject: String(x.subject ?? ''), status: String(x.status ?? 'pending') }))
    void set($, s => ({ tasks: fresh.map(x => ({ ...s.tasks.find(o => o.id === x.id), ...x })) }))
  } else if (tool === 'TodoWrite' && Array.isArray(input?.todos)) {
    const todos = (input.todos as TaskRow[]).map((x, i) => ({ id: `todo-${i}`, subject: String(x.content ?? ''), status: String(x.status ?? 'pending'), activeForm: x.activeForm }))
    void set($, () => ({ tasks: todos }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'dashboard', description: 'Open the usage dashboard' })
    void $.ui.open({ id: PANE, title: 'Dashboard' })
    await set($, () => ({ cwd: e.cwd, background: [], leaving: [] }))
    await refresh($)
    $.clock.every(1000, () => void refresh($))
    $.clock.every(125, () => void update($, frame, f => (f + 1) % 100_000).catch(() => 0))
    return next(e)
  })

  on('command.run', { command: 'dashboard' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Dashboard' })
    return { text: 'Usage dashboard opened.' }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const input = e as { session_title?: string; prompt?: string }
    readTurnInfo($, e)
    void set($, s => ({
      title: input.session_title || s.title || clip(oneLine(input.prompt ?? ''), 48),
      lastActivity: s.now,
    }))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const origin = (e as { origin?: { kind?: string } }).origin?.kind
    const raw = e.text ?? ''
    if (origin === 'task-notification' || raw.includes('<task-notification>')) {
      void set($, s => {
        const ended = s.background.filter(b => finished(b, raw))
        return {
          background: s.background.filter(b => !finished(b, raw)),
          log: ended.reduce((acc, b) => [...acc, { at: s.now, who: b.kind, text: `background job finished · ${clip(b.label, 60)}` }], s.log).slice(-40),
          lastActivity: s.now,
        }
      })
      return next(e)
    }
    const text = oneLine(raw)
    if (text && !text.startsWith('/') && (!origin || origin === 'user')) void set($, s => ({ title: s.title || clip(text, 48), lastActivity: s.now }))
    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    readTurnInfo($, e)
    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    readTurnInfo($, e)
    const inFlight = (e as { background_tasks?: { id: string }[] }).background_tasks
    if (Array.isArray(inFlight)) {
      const ids = new Set(inFlight.map(x => x.id))
      void set($, s => ({ background: s.background.filter(b => (b.taskId ? ids.has(b.taskId) : true)) }))
    }
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const title = (e as { session_title?: string }).session_title
    readTurnInfo($, e)
    if (title) void set($, () => ({ title }))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort !== undefined) {
      const effort = String(e.effort)
      void set($, s => (s.effort === effort ? {} : { effort }))
    }
    return yield* next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!(e as { agentId?: string }).agentId) void set($, s => ({ turnActive: true, lastActivity: s.now }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (HIDDEN_TOOLS.has(e.tool)) return next(e)
    const input = e as unknown as Record<string, unknown>
    const [kind, name] = classify(e.tool, input)
    const key = `${kind}|${name}`
    const isBackground = input?.run_in_background === true || e.tool === 'Monitor'
    const isAgent = e.tool === 'Agent' || e.tool === 'Task'
    void set($, s => {
      const byKind = { ...s.byKind }
      byKind[kind] = { ...(byKind[kind] ?? {}), [name]: (byKind[kind]?.[name] ?? 0) + 1 }
      const from = (e as { agentId?: string }).agentId ? 'agent' : 'main'
      const chats = isAgent
        ? pushChat(s, from, String(input?.name ?? input?.subagent_type ?? 'agent'), `▸ ${String(input?.description ?? 'new task')}`, s.now, 'spawn')
        : s.chats
      const log = isAgent
        ? pushLog(s, { who: from, color: PET_COLORS.B, to: String(input?.subagent_type ?? 'agent'), toColor: agentColor(String(input?.subagent_type ?? 'agent')), text: String(input?.description ?? 'new task') })
        : s.log
      return {
        log,
        toolCalls: s.toolCalls + 1,
        busy: s.busy + 1,
        active: { ...s.active, [key]: (s.active[key] ?? 0) + 1 },
        lastUsed: { ...s.lastUsed, [key]: s.now },
        current: shortTool(e.tool),
        lastActivity: s.now,
        byKind,
        chats,
      }
    })
    try {
      const r = await next(e)
      if (isBackground && !isAgent) {
        const text = String((r as { text?: unknown }).text ?? '')
        const taskId = /(?:ID|id|task[_ ]?id)[:=]?\s*"?([A-Za-z0-9_-]{5,})/.exec(text)?.[1]
        const label = String(input?.description ?? input?.command ?? e.tool)
        void set($, s => ({
          background: [...s.background, { id: e.tool_use_id, taskId, kind: e.tool, label: clip(oneLine(label), 80), since: s.now }].slice(-12),
          log: pushLog(s, { who: 'main', color: PET_COLORS.B, text: `started ${e.tool} in background · ${clip(oneLine(label), 60)}` }),
        }))
      }
      trackTasks($, e.tool, input, (r as { result?: unknown }).result)
      if ((r as { isError?: boolean }).isError) void set($, x => ({ puzzledUntil: x.now + 5000, puzzledBy: shortTool(e.tool) }))
      return r
    } finally {
      void set($, s => ({
        busy: Math.max(0, s.busy - 1),
        active: { ...s.active, [key]: Math.max(0, (s.active[key] ?? 0) - 1) },
        lastUsed: { ...s.lastUsed, [key]: s.now },
      }))
    }
  })

  on('session.send', async ($, e, next) => {
    void set($, s => {
      const from = e.agentId ? (s.agents.find(a => a.id === e.agentId)?.name ?? 'agent') : 'main'
      return { chats: pushChat(s, from, e.to, e.text, s.now), log: pushLog(s, { who: from, to: e.to, text: e.text }), lastActivity: s.now }
    })
    return next(e)
  })

  on('session.receive', async ($, e, next) => {
    const origin = e.origin as { kind: string; name?: string; from?: string }
    void set($, s => {
      if (origin.kind === 'task-notification') {
        const background = s.background.filter(b => !finished(b, e.text))
        return { background, lastActivity: s.now }
      }
      return { chats: pushChat(s, origin.name ?? origin.from ?? origin.kind, 'main', e.text, s.now), lastActivity: s.now }
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const u = r.usage
    const isMain = !(e as { agentId?: string }).agentId
    await set($, s => ({
      tokens: u ? s.tokens + u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : s.tokens,
      turnActive: isMain ? false : s.turnActive,
      lastActivity: s.now,
    }))
    await refresh($)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = { ...EMPTY, ...(await read($, stats)) }
    const tick = await read($, frame)
    const f = Math.floor(tick / 3)
    const total = Math.max(24, ((e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 40) - 4)
    const rows = e.viewport?.rows
    const twoCols = total >= 76
    const gap = 4
    const colW = twoCols ? Math.floor((total - gap) / 2) : total
    const labelW = 10

    const heading = (title: string, right = '', width = colW) => (
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color={C.label} bold>{title.toUpperCase()}</Text>
          {right ? <Text color={C.dim}> {right}</Text> : null}
        </Text>
        <Text color={C.rule}>{'─'.repeat(width)}</Text>
      </Box>
    )
    const row = (label: string, value: string, color = C.value) => (
      <Text>
        <Text color={C.label}>{label.padEnd(labelW)}</Text>
        <Text color={color} bold>{value}</Text>
      </Text>
    )
    const meter = (pctRaw: number, w: number) => {
      const p = Math.round(pctRaw)
      const col = p >= 85 ? C.bad : p >= 60 ? C.warn : C.fill
      const n = Math.round((Math.min(100, Math.max(0, p)) / 100) * w)
      return (
        <Text>
          <Text color={col}>{'━'.repeat(n)}</Text>
          <Text color={C.track}>{'━'.repeat(Math.max(0, w - n))}</Text>
          <Text color={col} bold> {String(p).padStart(3)}%</Text>
        </Text>
      )
    }
    const more = (n: number) => (n > 0 ? <Text color={C.dim}>  +{n} more</Text> : null)

    // ── header: session, path, model, effort, mode
    const isLive = s.turnActive || s.busy > 0
    const liveMode = s.mode || s.defaultMode
    const mode = MODE_LABEL[liveMode] ?? liveMode
    const modeColor = liveMode === 'plan' ? C.warn : liveMode === 'bypassPermissions' ? C.bad : C.value
    const header = (
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate">
          <Text color={isLive ? C.ok : C.dim}>{isLive ? '●' : '○'} </Text>
          <Text color={C.value} bold>{clip(s.title || 'untitled session', total - 2)}</Text>
        </Text>
        <Text wrap="truncate">
          <Text color={C.dim}>  dir    </Text>
          <Text color={C.text}>{clip(tidyPath(s.cwd || '—'), total - 9)}</Text>
        </Text>
        <Text wrap="truncate">
          <Text color={C.dim}>  model  </Text>
          <Text color={C.text}>{s.model || '—'}</Text>
          <Text color={C.dim}>   effort </Text>
          <Text color={s.effort ? C.value : C.dim} bold={!!s.effort}>{s.effort || '—'}</Text>
          <Text color={C.dim}>   mode </Text>
          <Text color={liveMode ? modeColor : C.dim} bold={!!s.mode}>{mode || '—'}</Text>
          {!s.mode && s.defaultMode ? <Text color={C.dim}> (default)</Text> : null}
        </Text>
      </Box>
    )

    // ── pet
    const mood = moodOf(s)
    const petLines = scene(mood, tick, s.agents.length).map(line => (
      <Text wrap="truncate">
        {runs(line).map(([t, bg, fg]) => (bg ? <Text backgroundColor={bg}>{t}</Text> : <Text color={fg}>{t}</Text>)) as never}
      </Text>
    ))
    const say = bubble(mood, s, f)
    const pet = (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="column" flexShrink={0} width={SPRITE_W * 2 + 1}>{petLines as never}</Box>
        <Box flexDirection="row" marginTop={1} gap={2}>
          <Text color={C.value} bold>{mood}</Text>
          {say ? <Text color={C.text} wrap="truncate">{clip(say, Math.max(6, colW - 14))}</Text> : null}
        </Box>
        <Box flexDirection="row" gap={2}>
          <Button
            key="pet"
            plain
            dimColor
            hotkey="p"
            onPress={async () => {
              await set($, x => ({ happyUntil: x.now + 3500, pets: x.pets + 1, lastActivity: x.now }))
            }}
          >
            pet
          </Button>
          <Text color={C.dim}>{s.pets ? `♥ ${s.pets}` : ''}</Text>
        </Box>
      </Box>
    )

    // ── usage, context, limits
    const barW = Math.max(8, Math.min(28, colW - labelW - 6))
    const usage = (
      <Box flexDirection="column">
        {heading('usage')}
        {row('tokens', fmtTokens(s.tokens))}
        {row('cost', `$${s.usd.toFixed(4)}`)}
        {row('tools', String(s.toolCalls))}
        {row('session', s.startedAt ? fmtClock(s.now - s.startedAt) : '—')}

        {heading('context', `${fmtTokens(s.contextTokens)} / ${fmtTokens(s.contextWindow)}`)}
        {meter(s.contextPct, Math.max(8, Math.min(36, colW - 6)))}

        {heading('limits')}
        {s.limits.length === 0 ? <Text color={C.dim}>no reading yet</Text> : null}
        {s.limits.map(l => (
          <Box flexDirection="column">
            <Text>
              <Text color={C.label}>{(LIMIT_LABEL[l.kind] ?? l.kind).padEnd(labelW)}</Text>
              {meter(l.percentUsed, barW)}
            </Text>
            {l.resetsAt ? <Text color={C.dim}>{' '.repeat(labelW)}resets {fmtReset(l.resetsAt, s.now)}</Text> : null}
          </Box>
        ))}
      </Box>
    )

    // ── room: agent map, participants, and the room log
    const talking = new Set(s.chats.filter(c => s.now - c.at < 6000).flatMap(c => [c.from, c.to]))
    const roomW = total
    const isStacked = roomW < 72
    const mapW = isStacked ? roomW : Math.max(40, Math.floor(roomW * 0.7))
    const sideW = isStacked ? roomW : roomW - mapW - 2
    const canvas = roomScene(s.agents, s.leaving, s.seenTick, talking, tick, mapW - 4, miniPetPixels(mood, tick))
    const newest = [...s.agents].sort((a, b) => b.since - a.since)
    const clockOf = (ms: number) => new Date(ms).toTimeString().slice(0, 8)
    const statusOf = (name: string, type: string) => (talking.has(name) || talking.has(type) ? 'TALKING' : 'ACTIVE')
    const sideRows = Math.max(4, canvas.length - 1)
    const panel = (title: string, w: number, body: unknown) => (
      <Box flexDirection="column" width={w} borderStyle="round" borderColor={C.rule} paddingX={1}>
        <Text color={C.label} bold>{title}</Text>
        {body as never}
      </Box>
    )
    const map = panel(
      `AGENT MAP · ${s.agents.length} active${s.leaving.length ? ` · ${s.leaving.length} leaving` : ''}`,
      mapW,
      canvas.map(line => (
        <Text wrap="truncate">
          {canvasRuns(line).map(([t, bg, fg]) => (bg ? <Text backgroundColor={bg} color={fg}>{t}</Text> : <Text color={fg}>{t}</Text>)) as never}
        </Text>
      )),
    )
    // two lines per participant: who and how, then what (the summary gets the full width)
    const detailW = Math.max(8, sideW - 6)
    const entry = (head: unknown, detail: string, detailColor: string) => (
      <Box flexDirection="column">
        <Text wrap="truncate">{head as never}</Text>
        <Text wrap="truncate" color={detailColor}>{'  └ '}{clip(oneLine(detail), detailW)}</Text>
      </Box>
    )
    const slots = Math.max(1, Math.floor((sideRows - 1) / 2))
    const runningShown = newest.slice(0, Math.max(0, slots - 1))
    const finishedShown = [...s.finished].reverse().slice(0, Math.max(0, slots - 1 - runningShown.length))
    const participantRows = [
      entry(
        [
          <Text backgroundColor={PET_COLORS.B}>{' '}</Text>,
          <Text color={C.value} bold> main</Text>,
          <Text color={C.text}> {mood}</Text>,
        ],
        `lead · ${fmtTokens(s.tokens)} tokens · ${s.toolCalls} tools · $${s.usd.toFixed(2)}`,
        C.dim,
      ),
      ...runningShown.map(a => {
        const isTalking = statusOf(a.name, a.type) === 'TALKING'
        return entry(
          [
            <Text backgroundColor={agentColor(a.type)}>{' '}</Text>,
            <Text color={agentColor(a.type)} bold> {clip(a.name, 16)}</Text>,
            <Text color={isTalking ? C.warn : C.ok}> {isTalking ? '◆ talking' : '● active'}</Text>,
            <Text color={C.value}> {fmtAgo(s.now - a.since)}</Text>,
          ],
          a.description,
          C.label,
        )
      }),
      ...finishedShown.map(x =>
        entry(
          [
            <Text color={C.ok}>✓</Text>,
            <Text color={C.label}> {clip(x.name, 16)}</Text>,
            <Text color={C.dim}> done · {fmtAgo(x.tookMs)}</Text>,
          ],
          x.description,
          C.dim,
        ),
      ),
    ]
    const hidden = newest.length - runningShown.length
    const participants = panel(
      `PARTICIPANTS (${s.agents.length + 1})`,
      sideW,
      [...participantRows, hidden > 0 ? <Text color={C.dim}>  +{hidden} more running</Text> : null],
    )
    const logLines = s.log.slice(-6)
    const log = panel(
      'LIVE INTERACTION STREAM',
      roomW,
      logLines.length === 0
        ? <Text color={C.dim}>quiet · main is alone in the room</Text>
        : logLines.map(l => (
          <Text wrap="truncate">
            <Text color={C.dim}>[{clockOf(l.at)}] </Text>
            <Text color={l.color ?? C.text} bold>{clip(l.who, 16)}</Text>
            {l.to ? <Text color={C.dim}> → </Text> : null}
            {l.to ? <Text color={l.toColor ?? C.text} bold>{clip(l.to, 16)}</Text> : null}
            <Text color={C.label}>: {oneLine(l.text)}</Text>
          </Text>
        )),
    )
    const room = (
      <Box flexDirection="column" flexGrow={1} marginBottom={1}>
        {heading('room', `${s.agents.length} active`, roomW)}
        <Box flexDirection={isStacked ? 'column' : 'row'} gap={isStacked ? 0 : 2}>
          {map}
          {participants}
        </Box>
        {log}
      </Box>
    )

    // ── tasks
    const taskOrder: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 }
    const taskList = [...s.tasks].sort((a, b) => (taskOrder[a.status] ?? 1) - (taskOrder[b.status] ?? 1))
    const doneCount = s.tasks.filter(x => x.status === 'completed').length
    const tasks = (
      <Box flexDirection="column">
        {heading('tasks', s.tasks.length ? `${doneCount}/${s.tasks.length}` : '0')}
        {s.tasks.length === 0 ? <Text color={C.dim}>no tasks</Text> : null}
        {taskList.slice(0, 5).map(x => {
          const isRunning = x.status === 'in_progress'
          const isDone = x.status === 'completed'
          const mark = isRunning ? '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[tick % 10] : isDone ? '✓' : '○'
          const label = isRunning && x.activeForm ? x.activeForm : x.subject
          return (
            <Text wrap="truncate">
              <Text color={isRunning ? C.value : isDone ? C.ok : C.dim}>{mark} </Text>
              <Text color={isRunning ? C.value : isDone ? C.dim : C.text} bold={isRunning} strikethrough={isDone}>{clip(oneLine(label), colW - 3)}</Text>
            </Text>
          )
        })}
        {more(taskList.length - 5)}
      </Box>
    )

    // ── background jobs
    const background = (
      <Box flexDirection="column">
        {heading('background', String(s.background.length))}
        {s.background.length > 0 ? (
          <Button key="clear-background" plain dimColor onPress={async () => { await set($, () => ({ background: [] })) }}>
            clear
          </Button>
        ) : null}
        {s.background.length === 0 ? <Text color={C.dim}>nothing running</Text> : null}
        {s.background.slice(-4).map(b => (
          <Text wrap="truncate">
            <Text color={C.fill}>{'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[tick % 10]} </Text>
            <Text color={C.text} bold>{b.kind.padEnd(10)}</Text>
            <Text color={C.dim}>{fmtAgo(s.now - b.since).padStart(6)} </Text>
            <Text color={C.label}>{clip(b.label, Math.max(0, colW - 20))}</Text>
          </Text>
        ))}
        {more(s.background.length - 4)}
      </Box>
    )

    // ── tools: a full-width strip at the bottom, one column per group.
    // In-flight first (white dot), then just finished (grey dot), then by calls.
    const isActive = (kind: string, name: string) => (s.active[`${kind}|${name}`] ?? 0) > 0
    const isRecent = (kind: string, name: string) => s.now - (s.lastUsed[`${kind}|${name}`] ?? 0) < 3000
    const rank = (kind: string, name: string) => (isActive(kind, name) ? 2 : isRecent(kind, name) ? 1 : 0)
    const groups = KINDS.map(k => {
      const items = Object.entries(s.byKind[k.key] ?? {}).sort(
        (a, b) => rank(k.key, b[0]) - rank(k.key, a[0]) || b[1] - a[1] || a[0].localeCompare(b[0]),
      )
      return { ...k, items, total: items.reduce((acc, [, c]) => acc + c, 0), top: items.length ? rank(k.key, items[0][0]) : 0 }
    })
      .filter(g => g.items.length > 0)
      .sort((a, b) => b.top - a.top || b.total - a.total)
    const groupW = 22
    const toolsW = twoCols ? colW : total
    const groupCols = Math.max(1, Math.min(groups.length || 1, Math.floor((toolsW + gap) / (groupW + gap))))
    const cellW = Math.floor((toolsW - gap * (groupCols - 1)) / groupCols)
    const perGroup = 4
    const tools = (
      <Box flexDirection="column" marginBottom={1}>
        {heading('tools', String(s.toolCalls), toolsW)}
        {groups.length === 0 ? <Text color={C.dim}>no calls yet</Text> : null}
        <Box flexDirection="row" columnGap={gap} rowGap={1} flexWrap="wrap">
          {groups.map(k => (
            <Box flexDirection="column" width={cellW}>
              <Text>
                <Text color={C.text} bold>{k.label}</Text>
                <Text color={C.dim}> {k.total}</Text>
              </Text>
              {k.items.slice(0, perGroup).map(([name, c]) => {
                const r = rank(k.key, name)
                return (
                  <Text wrap="truncate">
                    <Text color={r === 2 ? C.value : C.dim}>{r === 2 ? (tick % 4 < 3 ? '●' : '○') : r === 1 ? '·' : ' '}</Text>
                    <Text color={C.label}>{String(c).padStart(3)}  </Text>
                    <Text color={r === 2 ? C.value : C.text} bold={r === 2}>{clip(name, cellW - 7)}</Text>
                  </Text>
                )
              })}
              {k.items.length > perGroup ? <Text color={C.dim}>      +{k.items.length - perGroup} more</Text> : null}
            </Box>
          ))}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" paddingX={2} backgroundColor={C.bg} width={total + 4} {...(rows ? { minHeight: rows } : {})}>
        {header}
        <Text color={C.rule}>{'─'.repeat(total)}</Text>
        {twoCols ? (
          <Box flexDirection="row" gap={gap}>
            <Box flexDirection="column" width={colW}>
              {pet}
              {usage}
            </Box>
            <Box flexDirection="column" width={colW}>
              {tasks}
              {background}
              {tools}
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column">
            {pet}
            {usage}
            {tasks}
            {background}
            {tools}
          </Box>
        )}
        {room}
      </Box>
    )
  })
}
