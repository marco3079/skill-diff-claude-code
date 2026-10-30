---
name: review-edits
description: Mostra e ajuda a revisar as edições que o Claude Code fez nos arquivos do projeto (arquivos alterados, +linhas/−linhas, diff), para o usuário manter ou desfazer depois. Use quando o usuário pedir para "revisar edições", "o que você mudou", "ver as alterações", "aprovar alterações", "desfazer alterações" ou "mostrar o diff do que foi editado".
---

# Revisar edições do Claude

Um hook `PreToolUse` (`scripts/snapshot.js`) guarda a linha de base de cada arquivo antes da primeira edição feita por `Edit`, `Write`, `MultiEdit` ou `NotebookEdit`. Os scripts desta skill comparam o estado atual com essa linha de base.

## Pasta base

Resolva a pasta desta skill (onde está este `SKILL.md`): `~/.claude/skills/review-edits` se instalada pelo `install.js`, ou `${CLAUDE_PLUGIN_ROOT}/skills/review-edits` se instalada como plugin. Abaixo, `<BASE>` é essa pasta. Rode os comandos a partir do diretório do projeto (ou passe `--cwd <projeto>`).

## O que fazer

1. Para mostrar o que mudou:
   ```bash
   node "<BASE>/scripts/review.js" list
   node "<BASE>/scripts/review.js" diff <arquivo|nº> [--context 3]
   ```
   `list` mostra "N arquivos alterados +A −D" e, por arquivo, o status (M modificado, A novo, D apagado) e `+N −M`. Resuma o resultado ao usuário em poucas linhas.
2. Para revisão interativa, NÃO tente abrir a interface você mesma. Imprima este comando para o usuário copiar num SEGUNDO terminal:
   ```bash
   node "<BASE>/scripts/tui.js" --cwd "<pasta do projeto>"
   ```
   (com `<BASE>` e a pasta do projeto já substituídos por caminhos reais).
3. Outros subcomandos: `status` (uma linha, útil para statusline) e `json` (saída para máquina).

## Regras de segurança

- NUNCA rode `review.js undo` nem `review.js keep` por conta própria. Só execute se o usuário pedir expressamente no chat ou confirmar depois de você propor. `undo` é destrutivo: restaura a linha de base (arquivo novo é apagado).
- Formas disponíveis, quando autorizado: `keep|undo <arquivo|nº|all>` e `keep|undo <arquivo|nº> --hunk N` (só o trecho `#N` mostrado no `diff`).
- `keep` aceita o estado atual e passa a usá-lo como nova linha de base.

## Limitações

- Só captura `Edit`, `Write`, `MultiEdit` e `NotebookEdit`. Mudanças feitas via Bash (`sed`, `git checkout`, `mv` etc.) não entram.
- A linha de base começa na primeira edição vista pelo hook; alterações anteriores à instalação não aparecem.
- Arquivos binários ou maiores que 1 MB são ignorados. Os dados ficam em `~/.claude-review` (ou `CLAUDE_REVIEW_DIR`).
