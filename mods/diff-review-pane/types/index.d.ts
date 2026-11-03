export type FileInfo = {
  n: number
  path: string
  /** M = modificado, A = novo, D = apagado */
  status: string
  add: number
  del: number
}

export type ReviewView = {
  count: number
  add: number
  del: number
  files: FileInfo[]
  /** Arquivo aberto no detalhe ('' = nenhum). */
  selected: string
  /** Diff do arquivo aberto, sem cores, uma linha por item. */
  diff: string[]
  /** Ação destrutiva aguardando o segundo clique de confirmação ('' = nenhuma). */
  confirm: string
  /** Mensagem de erro/ajuda para mostrar no painel. */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'diff-review-pane': {
      view: Shaped<ReviewView>
    }
  }
}
