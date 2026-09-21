/**
 * Ponte minimo fra il processo principale e la pagina: solo cio' che serve,
 * niente accesso a Node dalla pagina (sandbox + isolamento del contesto).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('visualizzatoreDesktop', {
  /** File aperto dal menu, dalla riga di comando o dal doppio clic sul .stp. */
  suApriFile: (callback) => {
    ipcRenderer.on('apri-file', (_ev, payload) => callback(payload));
  },
  /** Voce di menu «Comandi e scorciatoie». */
  suMostraAiuto: (callback) => {
    ipcRenderer.on('mostra-aiuto', () => callback());
  },
  apriDialogo: () => ipcRenderer.invoke('apri-dialogo'),
  informazioni: () => ipcRenderer.invoke('informazioni'),
  mostraInformazioni: () => ipcRenderer.invoke('mostra-informazioni'),
});
