# INSTALL.md — instruções para o Claude Code

> Este arquivo é lido pelo Claude quando o usuário pede para instalar este projeto. Siga os passos na ordem.

## Passos (instala tudo de uma vez: Claude Code desktop, terminal e VS Code)

Este repositório contém a skill `review-edits`, o painel `/revisao` do Claude Code desktop (plugin `diff-review-pane`) e a extensão `claude-review` do VS Code.

1. **Obtenha o repositório** (se ainda não estiver em disco): `git clone <url deste repositório>` numa pasta de projetos do usuário e entre nela. Se o usuário já abriu esta pasta, pule.
2. **Simule** (não altera nada): `node install.js --dry-run`. Resuma ao usuário em poucas linhas o que será instalado (a skill, a extensão do VS Code e o painel do Claude Code desktop).
3. **Faça UMA pergunta de confirmação** ao usuário: "Posso instalar tudo?" Pergunte também (na mesma mensagem) se quer o hook de snapshot, que é o que captura as edições para aparecerem no painel (`--hooks`, mexe em `~/.claude/settings.json` com backup). Sem "sim" explícito, não use `--hooks`.
4. **Instale**: `node install.js`  (acrescente `--hooks` só se o usuário disse sim ao hook)
   - Sem o comando `code` no PATH, o instalador avisa e segue; não tente instalar o VS Code. Outro editor: `--editor cursor`.
   - Sem o comando `claude` no PATH, ele pula o painel e imprime o comando `/plugin install` para o usuário digitar.
   - Só uma parte: `--skill`, `--extensions` ou `--plugins`.
5. **Avise o usuário**: no Claude Code desktop rode `/reload-plugins` (ou abra nova sessão) e use `/revisao`; no VS Code, `Ctrl+Shift+P` → "Developer: Reload Window".

## Só Claude Code (sem VS Code)

Se o usuário usa apenas o Claude Code no terminal, há duas formas. A extensão do VS Code não é necessária.

- **Plugin** (o usuário digita no Claude Code): `/plugin marketplace add marco3079/skill-diff-claude-code` e `/plugin install diff-review@skill-diff-claude-code`.
- **Via install.js**:
  1. `node install.js --skill --dry-run`, resuma, peça confirmação e rode `node install.js --skill` (copia `skills/review-edits` para `~/.claude/skills`).
  2. O hook que captura as edições **é opcional e ALTERA o `~/.claude/settings.json`** (adiciona uma entrada `PreToolUse` para `review-edits/scripts/snapshot.js`; faz backup `settings.json.bak-<data>`; não mexe no resto). **Exige confirmação expressa do usuário**: explique isso, rode `node install.js --hooks --dry-run`, e só então `node install.js --hooks` após um "sim" claro. Nunca rode `--hooks` por padrão. Para remover: `node install.js --remove-hooks`. Se o JSON existente for inválido, o instalador aborta sem alterar nada.
  3. Avise: abrir uma NOVA sessão do Claude Code; revisar com `review.js list|diff|keep|undo` ou, num segundo terminal, `node ~/.claude/skills/review-edits/scripts/tui.js`.

## Regras

- Não altere nenhuma configuração do usuário além do que o `install.js` faz.
- Não execute nada além de `git clone` e `node install.js` para instalar.
- `--hooks` e `--remove-hooks` só com pedido ou confirmação expressa. Nunca rode `review.js undo` ou `keep` sem pedido expresso do usuário.
