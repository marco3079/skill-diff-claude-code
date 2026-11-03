import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { FileInfo, ReviewView } from '../types'

const PANE = 'revisao'
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// Faixa de destaque (só nas superfícies gráficas): total de arquivos, +/− e barra de proporção.
function heroSvg(count: number, add: number, del: number, files: FileInfo[]): string {
  const W = 640
  const pct = add + del === 0 ? 0.5 : add / (add + del)
  const bw = 600
  const kinds: Array<[string, number, string]> = [
    ['ALTERADOS', files.filter(f => f.status === 'M').length, '#61afef'],
    ['NOVOS', files.filter(f => f.status === 'A').length, '#98c379'],
    ['APAGADOS', files.filter(f => f.status === 'D').length, '#e06c75'],
  ]
  const tiles = kinds.map(([label, n, c], i) => {
    const x = 20 + i * 154
    return `<rect x="${x}" y="104" width="144" height="46" rx="12" fill="#ffffff" fill-opacity="0.07"/>` +
      `<text x="${x + 14}" y="123" font-family="Segoe UI,Arial" font-size="10" letter-spacing="1" fill="#abb2bf">${label}</text>` +
      `<text x="${x + 14}" y="143" font-family="Segoe UI,Arial" font-size="18" font-weight="700" fill="${c}">${n}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 166" width="${W}">` +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16303a"/><stop offset="1" stop-color="#2a2547"/></linearGradient></defs>' +
    `<rect width="${W}" height="166" rx="18" fill="url(#g)"/>` +
    `<text x="20" y="40" font-family="Segoe UI,Arial" font-size="24" font-weight="700" fill="#ffffff">${count} ${count === 1 ? 'arquivo alterado' : 'arquivos alterados'}</text>` +
    `<text x="${W - 20}" y="40" text-anchor="end" font-family="Segoe UI,Arial" font-size="20" font-weight="700"><tspan fill="#98c379">+${add}</tspan><tspan fill="#abb2bf"> </tspan><tspan fill="#e06c75">−${del}</tspan></text>` +
    `<rect x="20" y="62" width="${bw}" height="12" rx="6" fill="#e06c75"/>` +
    `<rect x="20" y="62" width="${Math.round(bw * pct)}" height="12" rx="6" fill="#98c379"/>` +
    `<text x="20" y="94" font-family="Segoe UI,Arial" font-size="11" fill="#abb2bf">${Math.round(pct * 100)}% adições · ${100 - Math.round(pct * 100)}% remoções</text>` +
    tiles + '</svg>'
}
const bar = (a: number, d: number) => (a + d === 0 ? 10 : Math.max(1, Math.min(19, Math.round((20 * a) / (a + d)))))
const GREEN = '#98c379'
const RED = '#e06c75'
const BLUE = '#61afef'

// Mude a etiqueta quando os campos mudarem: ela descarta o que uma versão antiga guardou.
const view = atom(
  { plugin: 'diff-review-pane', key: 'view' } as const,
  { count: 0, add: 0, del: 0, files: [], selected: '', diff: [], confirm: '', note: '' } as ReviewView,
  { shape: 'view-1' },
)

let cwd = ''
let lastSig = ''

let HOME = ''
async function initHome($: any): Promise<void> {
  if (HOME) return
  const h = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  HOME = String(h).split(String.fromCharCode(92)).join('/')
}
function homeOf(root: string): string {
  if (HOME) return HOME
  const r = root.split('\\').join('/')
  const i = r.indexOf('/.claude/')
  return i >= 0 ? r.slice(0, i) : ''
}
const reviewJs = (root: string) => `${homeOf(root)}/.claude/skills/review-edits/scripts/review.js`

// Roda o review.js (o mesmo motor do plugin de terminal) sem cores.
async function review($: any, args: string[]) {
  return $.process.run(['node', reviewJs($.plugin.root), '--cwd', cwd, ...args], {
    env: { NO_COLOR: '1' },
    timeoutMs: 20000,
  }) as Promise<{ exitCode: number; stdout: string; stderr: string }>
}

async function refresh($: any, force = false): Promise<void> {
  if (!cwd) return
  const cur = await read($, view)
  const r = await review($, ['json']).catch(() => undefined)
  if (!r || r.exitCode !== 0) {
    const note = 'Não consegui ler as edições: instale a skill review-edits (node install.js --skill).'
    if (cur.note !== note) await update($, view, v => ({ ...v, note }))
    return
  }
  let j: any
  try { j = JSON.parse(r.stdout) } catch { return }
  const files: FileInfo[] = (j.files ?? []).map((f: any) => ({
    n: f.n, path: String(f.path), status: String(f.status), add: f.add ?? 0, del: f.del ?? 0,
  }))
  const selected = files.some(f => f.path === cur.selected) ? cur.selected : ''
  let diff: string[] = cur.diff
  const sig = JSON.stringify([files, selected])
  if (force || sig !== lastSig) {
    diff = []
    if (selected) {
      const d = await review($, ['diff', selected, '--context', '3']).catch(() => undefined)
      if (d && d.exitCode === 0) diff = d.stdout.split('\n')
    }
    lastSig = sig
    const confirm = selected === cur.selected ? cur.confirm : ''
    await update($, view, () => ({ count: j.count ?? files.length, add: j.add ?? 0, del: j.del ?? 0, files, selected, diff, confirm, note: '' }))
  }
  $.ui.status(files.length ? `${files.length} edição(ões) pendente(s) +${j.add ?? 0} −${j.del ?? 0}` : undefined)
}

async function act($: any, args: string[]): Promise<void> {
  const r = await review($, args).catch(() => undefined)
  if (!r || r.exitCode !== 0) {
    const msg = (r && (r.stderr || r.stdout) || 'falhou').trim().slice(0, 200)
    await update($, view, v => ({ ...v, confirm: '', note: `Erro: ${msg}` }))
    return
  }
  await update($, view, v => ({ ...v, confirm: '', note: '' }))
  await refresh($, true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'revisao',
      description: 'Abre o painel de revisão das edições (diff, Manter/Desfazer)',
    })
    await initHome($)
    cwd = e.cwd ?? (await $.session.cwd().catch(() => '')) ?? cwd
    void refresh($)
    $.clock.every(2000, () => { void refresh($) })
    return next(e)
  })

  for (const cmd of ['revisao']) on('command.run', { command: cmd }, async ($, e) => {
    await initHome($)
    if (!cwd) cwd = (await $.session.cwd().catch(() => '')) ?? ''
    await refresh($, true)
    const opened = await $.ui.open({ id: PANE, title: 'Revisão de edições', focus: true })
    return {
      text: opened.isPlaced
        ? 'Painel de revisão aberto.'
        : 'Não há espaço para o painel agora: aumente a janela ou rode /revisao de novo.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Svg } = $.ui.resolve(e) as any
    const v = await read($, view)
    const rows = Math.max(4, (e.viewport?.rows ?? 28) - 8 - Math.min(v.files.length, 8))
    const cols = Math.max(30, (e.viewport?.columns ?? 100) - 6)

    // Ações destrutivas pedem dois cliques: o primeiro arma, o segundo executa.
    const confirmable = (id: string, args: string[]) => () => {
      if (v.confirm === id) { void act($, args); return }
      void update($, view, cur => ({ ...cur, confirm: id }))
    }
    const select = (path: string) => () => {
      void update($, view, cur => ({ ...cur, selected: path, confirm: '' })).then(() => refresh($, true))
    }

    const sel = v.files.find(f => f.path === v.selected)
    const shown = v.diff.slice(0, rows)
    const hidden = Math.max(0, v.diff.length - shown.length)

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={BLUE} paddingX={1}>
        {v.files.length === 0 ? (
          <Text dimColor>✓ Nenhuma edição pendente. As edições do Claude aparecem aqui (hook do review-edits).</Text>
        ) : (
          <Box flexDirection="column">
            {Svg ? (
              <Svg source={heroSvg(v.count, v.add, v.del, v.files)} alt={`${v.count} arquivos alterados, +${v.add} −${v.del}`} />
            ) : null}
            {Svg ? null : <Text bold color={BLUE}>
              📝 {v.count} {v.count === 1 ? 'arquivo alterado' : 'arquivos alterados'}{' '}
              <Text color={GREEN}>+{v.add}</Text> <Text color={RED}>−{v.del}</Text>
            </Text>}
            {Svg ? null : <Text>
              <Text color={GREEN}>{'█'.repeat(bar(v.add, v.del))}</Text>
              <Text color={RED}>{'█'.repeat(20 - bar(v.add, v.del))}</Text>
              <Text dimColor> {v.add + v.del === 0 ? '' : `${Math.round((100 * v.add) / (v.add + v.del))}% adições`}</Text>
            </Text>}
          </Box>
        )}
        {v.note ? <Text color={RED}>{v.note}</Text> : null}
        {v.files.length > 0 && (
          <Box>
            <Button key="keepAll" variant="primary" onPress={() => { void act($, ['keep', 'all']) }}>✓ Manter tudo</Button>
            <Button key="undoAll" variant="secondary" onPress={confirmable('all', ['undo', 'all'])}>
              {v.confirm === 'all' ? '⚠ Confirmar: desfazer tudo?' : '↺ Desfazer tudo'}
            </Button>
          </Box>
        )}
        {v.files.map(f => (
          <Button key={`f:${f.path}`} onPress={select(f.path)}>
            {f.path === v.selected ? '▸ ' : '  '}
            <Text color={f.status === 'D' ? RED : f.status === 'A' ? GREEN : BLUE}>{f.status === 'D' ? '🗑' : f.status === 'A' ? '✨' : '✏️'}</Text> {f.path}{' '}
            <Text color={f.add ? GREEN : undefined} dimColor={!f.add}>+{f.add}</Text>{' '}
            <Text color={f.del ? RED : undefined} dimColor={!f.del}>−{f.del}</Text>
          </Button>
        ))}
        {sel && (
          <Box flexDirection="column">
            <Text bold color={BLUE}>📄 {sel.path}</Text>
            <Box>
              <Button key="keepFile" variant="primary" onPress={() => { void act($, ['keep', sel.path]) }}>Manter arquivo</Button>
              <Button key="undoFile" variant="secondary" onPress={confirmable(`file:${sel.path}`, ['undo', sel.path])}>
                {v.confirm === `file:${sel.path}` ? 'Confirmar: desfazer arquivo?' : 'Desfazer arquivo'}
              </Button>
            </Box>
            {shown.map((line, i) => {
              const hunk = /^#(\d+) @@/.exec(line)
              if (hunk) {
                const n = hunk[1]
                return (
                  <Box>
                    <Text color={BLUE}>{line.slice(0, cols)} </Text>
                    <Button key={`k:${n}`} plain onPress={() => { void act($, ['keep', sel.path, '--hunk', n]) }}>✓ Manter</Button>
                    <Button key={`u:${n}`} plain onPress={confirmable(`hunk:${sel.path}:${n}`, ['undo', sel.path, '--hunk', n])}>
                      {v.confirm === `hunk:${sel.path}:${n}` ? '↺ Confirmar?' : '↺ Desfazer'}
                    </Button>
                  </Box>
                )
              }
              const c = line[0]
              return (
                <Text key={`l:${i}`} color={c === '+' ? GREEN : c === '-' ? RED : undefined} dimColor={c !== '+' && c !== '-'}>
                  {line.slice(0, cols)}
                </Text>
              )
            })}
            {hidden > 0 ? <Text dimColor>… {hidden} linhas ocultas (aumente o painel)</Text> : null}
          </Box>
        )}
      </Box>
    )
  })
}
