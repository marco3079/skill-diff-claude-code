'use strict';

const vscode = require('vscode');
const { Store } = require('./store');
const { activateUI } = require('./ui');

function activate(context) {
  try {
    const store = new Store(context);
    context.subscriptions.push(store);

    // UI primeiro (registra views/comandos/listeners); o scan roda em segundo plano.
    activateUI(context, store);

    Promise.resolve()
      .then(() => store.init())
      .catch((e) => {
        console.error('[claudeReview] init', e);
        vscode.window.showErrorMessage(`Claude Review: falha ao inicializar (${e && e.message ? e.message : e})`);
      });
  } catch (e) {
    console.error('[claudeReview] activate', e);
    vscode.window.showErrorMessage(`Claude Review: falha ao ativar (${e && e.message ? e.message : e})`);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
