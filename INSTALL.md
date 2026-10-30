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

## Regras

- Não altere nenhuma configuração do usuário além do que o `install.js` faz.
- Não execute nada além de `git clone` e `node install.js` para instalar.
