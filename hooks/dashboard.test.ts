import { test, expect } from 'claude-code/testing'

const pane = (columns: number, rows = 60) =>
  ({ plugin: 'usage-dashboard', component: 'Pane', props: { bodyColumns: columns }, requestId: 'dashboard', viewport: { columns, rows } }) as const

test('tools are grouped by kind', async ($, on) => {
  on('tool.call', async () => ({ result: { text: 'ok' } }) as never)
  await $.tool.call({ tool: 'Bash', command: 'echo hi' } as never)
  await $.tool.call({ tool: 'Skill', skill: 'caveman' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(50), surface } as never)
    expect(await ui.find({ type: 'Text', text: /^skills$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /caveman/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^built-in$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /LIMITS/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ROOM/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^idle$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('petting makes the pet happy; a wide pane uses two columns', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(110, 50), surface } as never)
    expect(await ui.find({ type: 'Text', text: /BACKGROUND/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /TOOLS/ })).toBeDefined()
    await ui.press({ key: 'pet' })
    expect(await ui.find({ type: 'Text', text: /^♥ [0-9]+$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('every mood draws its prop without breaking the pane', async ($, on) => {
  on('tool.call', async () => ({ result: { text: 'ok' } }) as never)
  for (const tool of ['Edit', 'Grep', 'Read']) await $.tool.call({ tool } as never)
  const ui = await $.ui.mount({ ...pane(110, 50), surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /USAGE/ })).toBeDefined()
  await ui.unmount()
})

test('the tool in flight goes first with a dot', async ($, on) => {
  let release = () => {}
  on('tool.call', async (_, e) => {
    if ((e as { tool: string }).tool === 'PowerShell') await new Promise<void>(r => (release = r))
    return { result: { text: 'ok' } } as never
  })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash' } as never)
  const running = $.tool.call({ tool: 'PowerShell' } as never)
  await new Promise(r => setTimeout(r, 20))
  const ui = await $.ui.mount({ ...pane(110), surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /^[●○]$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^coding$/ })).toBeDefined()
  await ui.unmount()
  release()
  await running
})

test('tasks are listed and change status', async ($, on) => {
  on('tool.call', async (_, e) => {
    if ((e as { tool: string }).tool === 'TaskCreate') return { result: { task: { id: '7', subject: 'Try the pane' } } } as never
    return { result: { success: true, taskId: '7', updatedFields: ['status'] } } as never
  })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Try the pane', description: 'x', activeForm: 'Trying the pane' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' } as never)
  const ui = await $.ui.mount({ ...pane(110), surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /TASKS/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Trying the pane$/ })).toBeDefined()
  await ui.unmount()
})

test('a background job leaves when its task-notification arrives', async ($, on) => {
  on('tool.call', async () => ({ result: { text: 'Command running in background with ID: bjob12345.' }, text: 'Command running in background with ID: bjob12345.' }) as never)
  on('prompt.submit', async (_, e) => ({ ...(e as object) }) as never)
  await $.tool.call({ tool: 'Bash', command: 'sleep 9', run_in_background: true } as never)
  let ui = await $.ui.mount({ ...pane(110), surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /^BACKGROUND$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ 1$/ })).toBeDefined()
  await ui.unmount()
  await $.prompt.submit({ text: '<task-notification><task-id>bjob12345</task-id><status>completed</status></task-notification>' } as never).catch(() => {})
  ui = await $.ui.mount({ ...pane(110), surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /nothing running/ })).toBeDefined()
  await ui.unmount()
})

test('a failing tool puzzles the pet', async ($, on) => {
  on('tool.call', async () => ({ result: { text: 'boom' }, isError: true }) as never)
  await $.tool.call({ tool: 'Bash', command: 'false' } as never)
  const ui = await $.ui.mount({ ...pane(110), surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /^puzzled$/ })).toBeDefined()
  await ui.unmount()
})

test('mode and effort come from the turn', async $ => {
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'plan', effort: { level: 'high' } } as never).catch(() => {})
  const ui = await $.ui.mount({ ...pane(110), surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /^plan$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^high$/ })).toBeDefined()
  await ui.unmount()
})

test('the room shows a map, its participants and a live log', async ($, on) => {
  on('tool.call', async () => ({ result: { text: 'ok' } }) as never)
  await $.tool.call({ tool: 'Agent', subagent_type: 'Explore', description: 'Scan files', prompt: 'x' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(120, 70), surface } as never)
    expect(await ui.find({ type: 'Text', text: /AGENT MAP/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /PARTICIPANTS/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /LIVE INTERACTION STREAM/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Scan files/ })).toBeDefined()
    await ui.unmount()
  }
})
