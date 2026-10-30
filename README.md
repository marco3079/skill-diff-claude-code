# skill-diff-claude-code

Extensão do VS Code **Claude Review**: acumula as edições que o Claude Code (ou qualquer programa) faz nos seus arquivos, para você **revisar e aprovar depois**, no estilo do "working set" do Copilot Chat.

- **Cartão de resumo** no painel lateral: "N arquivos alterados +A −D", com **Manter** / **Desfazer**.
- **Lista de arquivos** com `+N −M`; clique abre o **diff nativo** do VS Code. Passe o mouse para manter/desfazer só aquele arquivo.
- **No editor**: linhas novas em verde, texto removido em vermelho ao lado da linha, e **Manter** / **Desfazer** acima de cada trecho (CodeLens).
- **Manter tudo / Desfazer tudo**, navegação entre alterações (`Alt+F5`), atalhos `Ctrl+Alt+Enter` (manter) e `Ctrl+Alt+Backspace` (desfazer) no arquivo ativo.
- Edições pendentes sobrevivem a recarregar o VS Code.

Dica: coloque o Claude Code em modo de aceitar edições automaticamente; ele grava direto no disco e a extensão junta tudo para você aprovar depois.

## Instalar com um prompt

Abra o Claude Code e cole:

```
Instale o projeto https://github.com/SEU_USUARIO/skill-diff-claude-code seguindo o INSTALL.md do repositório.
```

O Claude baixa o repositório, mostra o que vai fazer, pede sua confirmação e roda o instalador.
Depois: recarregue o VS Code (`Ctrl+Shift+P` → *Developer: Reload Window*).

### Instalar manualmente

```bash
git clone https://github.com/SEU_USUARIO/skill-diff-claude-code.git
cd skill-diff-claude-code
node install.js --dry-run   # mostra o que será feito, sem alterar nada
node install.js             # instala a extensão
```

Opções: `--build` (recompila o `.vsix`), `--editor cursor` (outro editor compatível). O instalador só roda `code --install-extension` com o arquivo de `dist/`; não altera suas configurações.

## Limitações

- Não é pixel-idêntico ao Copilot: a interface dele usa APIs internas do VS Code. Aqui usamos o editor de diff nativo, decorações e CodeLens.
- O VS Code não permite inserir linhas inteiras no editor, então o texto removido aparece em uma linha ("− texto antigo") e completo no hover e no diff.
- Rastreia **qualquer** mudança em disco no workspace (inclusive seus próprios saves e arquivos gerados). Ajuste `claudeReview.excludeDirs` para ignorar pastas.
- O estado inicial é um snapshot tirado quando o VS Code abre; arquivos não rastreados usam o `git HEAD` como base quando possível.

## Estrutura

```
extensions/claude-review/   código-fonte da extensão
dist/                       .vsix pronto para instalar
install.js                  instalador (Windows, macOS, Linux)
INSTALL.md                  instruções que o Claude segue ao instalar
```

Licença: MIT.
