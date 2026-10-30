# INSTALL.md — instruções para o Claude Code

> Este arquivo é lido pelo Claude quando o usuário pede para instalar este projeto. Siga os passos na ordem.

Este repositório contém a extensão de VS Code `claude-review` (revisão e aprovação de edições com diff).

## Passos

1. **Obtenha o repositório** (se ainda não estiver em disco): `git clone <url deste repositório>` numa pasta temporária ou de projetos do usuário e entre nela. Se o usuário já abriu esta pasta, pule.
2. **Simule** (não altera nada):
   ```bash
   node install.js --dry-run
   ```
   Resuma ao usuário em poucas linhas: instala a extensão `claude-review` (de `dist/`) no VS Code pela CLI `code`. Não mexe em `settings.json`, hooks ou permissões.
3. **Peça confirmação** ao usuário. Só continue com um "sim" claro.
4. **Instale**:
   ```bash
   node install.js
   ```
   Se o comando `code` não for encontrado, mostre a mensagem do instalador ao usuário (não tente instalar o VS Code). Outro editor compatível: `--editor cursor`. Recompilar o `.vsix` a partir do código: `--build` (precisa de Node/npm).
5. **Avise o usuário**: recarregar o VS Code (`Ctrl+Shift+P` → "Developer: Reload Window"). O ícone **Claude Review** aparece na barra lateral.

## Só Claude Code (sem VS Code)

Se o usuário usa apenas o Claude Code no terminal, há duas formas. A extensão do VS Code não é necessária.

- **Plugin** (o usuário digita no Claude Code): `/plugin marketplace add SEU_USUARIO/skill-diff-claude-code` e `/plugin install claude-diff-review@skill-diff-claude-code`.
- **Via install.js**:
  1. `node install.js --skill --dry-run`, resuma, peça confirmação e rode `node install.js --skill` (copia `skills/review-edits` para `~/.claude/skills`).
  2. O hook que captura as edições **é opcional e ALTERA o `~/.claude/settings.json`** (adiciona uma entrada `PreToolUse` para `review-edits/scripts/snapshot.js`; faz backup `settings.json.bak-<data>`; não mexe no resto). **Exige confirmação expressa do usuário**: explique isso, rode `node install.js --hooks --dry-run`, e só então `node install.js --hooks` após um "sim" claro. Nunca rode `--hooks` por padrão. Para remover: `node install.js --remove-hooks`. Se o JSON existente for inválido, o instalador aborta sem alterar nada.
  3. Avise: abrir uma NOVA sessão do Claude Code; revisar com `review.js list|diff|keep|undo` ou, num segundo terminal, `node ~/.claude/skills/review-edits/scripts/tui.js`.

## Regras

- Não altere nenhuma configuração do usuário além do que o `install.js` faz.
- Não execute nada além de `git clone` e `node install.js` para instalar.
- `--hooks` e `--remove-hooks` só com pedido ou confirmação expressa. Nunca rode `review.js undo` ou `keep` sem pedido expresso do usuário.
