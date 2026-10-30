# Claude Review

Extensão do VS Code que acumula as edições feitas em disco (por exemplo, pelo Claude Code) e deixa você revisá-las depois, de forma parecida com o "working set" do Copilot Chat.

## O que faz

- Tira um snapshot do workspace e observa mudanças em disco; o que diverge da base fica como "edição pendente".
- Painel "Edições pendentes" na barra de atividades, com contagem `+N −M` por arquivo.
- Diff nativo do VS Code (base vs. atual), decorações inline nas linhas alteradas e CodeLens com **Manter** / **Desfazer** por trecho.
- Ações por arquivo e globais: Manter arquivo, Desfazer arquivo, **Manter tudo**, **Desfazer tudo**, Próxima/Anterior alteração.
- Atalhos: `Ctrl+Alt+Enter` mantém o arquivo, `Ctrl+Alt+Backspace` desfaz o arquivo, `Alt+F5` vai para a próxima alteração.
- Pendências são restauradas ao reabrir o workspace.

## Como testar (F5)

1. Abra a pasta `claude-review` no VS Code.
2. Pressione `F5` (configuração "Run Extension"). Uma janela Extension Host será aberta.
3. Nessa janela, abra um projeto, edite arquivos (ou deixe o Claude Code editar) e veja o painel Claude Review.

## Empacotar e instalar

```
npx @vscode/vsce package
code --install-extension claude-review-0.1.0.vsix
```

## Uso com o Claude Code

Rode o Claude Code no modo `acceptEdits` (auto-accept edits) para que as edições sejam gravadas direto em disco sem aprovação individual. A extensão as acumula e você revisa tudo depois: abre o diff, mantém ou desfaz por trecho, por arquivo ou tudo de uma vez.

## Configurações

- `claudeReview.excludeDirs`: pastas ignoradas.
- `claudeReview.maxFileSizeKB` (512): tamanho máximo de arquivo acompanhado.
- `claudeReview.maxSnapshotFiles` (20000): limite de arquivos no snapshot.
- `claudeReview.openDiffOnFirstChange` (false): abre o diff na primeira edição pendente.

## Limitações

- **Não é idêntico ao Copilot, pixel a pixel.** A interface do Copilot usa APIs internas/proposed do VS Code, indisponíveis para extensões. Aqui usamos o editor de diff nativo, decorações com as mesmas cores de tema do diff e CodeLens.
- Arquivos binários, maiores que o limite, fora do workspace ou em pastas excluídas são ignorados.
- Para arquivos que já existiam, quando a primeira mudança acontece depois do início da sessão e sem snapshot prévio, a base vem de `git show HEAD:<arquivo>`; sem git, a mudança é ignorada.
- "Desfazer" altera ou apaga arquivos em disco (arquivos novos vão para a lixeira).
