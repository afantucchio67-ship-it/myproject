/**
 * Processo principale dell'app desktop (Electron).
 *
 * Scelte importanti:
 * - i file dell'applicazione sono serviti da un protocollo interno
 *   (`visualizzatore://app/...`) che legge dall'archivio `app.asar`: non serve
 *   nessuna porta di rete, niente firewall, tutto funziona offline;
 * - la finestra gira in sandbox, senza Node e senza strumenti di sviluppo;
 * - la navigazione fuori dall'app e' bloccata: i collegamenti e-mail, telefono
 *   e web si aprono nelle applicazioni di sistema.
 */
import { BrowserWindow, Menu, app, dialog, ipcMain, net, protocol, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCHEMA = 'visualizzatore';
const ORIGINE = `${SCHEMA}://app`;
const RADICE = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const ESTENSIONI = ['stp', 'step', 'p21', 'STP', 'STEP', 'P21'];
const MARCHIO = { nome: 'Antonio Fantucchio', ruolo: 'Software Engineer', email: 'a.fantucchio67@gmail.com', telefono: '+39 392 0021816' };

// 'self' = l'origine dell'app (il protocollo interno): tutto il resto e' negato
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",   // gli stili in linea servono ai pannelli
  "img-src 'self' data: blob:",          // logo incorporato e immagini esportate
  "font-src 'self'",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const TIPI = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEMA,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
}]);

// sandbox del renderer sempre attiva; si rispetta --no-sandbox solo quando
// viene passato dall'esterno (ambienti di test o container che girano da root)
if (!process.argv.includes('--no-sandbox')) app.enableSandbox();
app.setAboutPanelOptions({
  applicationName: app.getName(),
  applicationVersion: app.getVersion(),
  copyright: `© ${MARCHIO.nome} — ${MARCHIO.ruolo}\n${MARCHIO.email} · ${MARCHIO.telefono}`,
  credits: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
});

let finestra = null;
const codaFile = [];  // file da aprire prima che la finestra sia pronta

/* --------------------------------------------------------- apertura file */

/** Un argomento della riga di comando che sembra un percorso di file STEP. */
function fileDaArgomenti(argv) {
  return argv.slice(1).find((a) => !a.startsWith('-') && /\.(stp|step|p21)$/i.test(a));
}

async function inviaFile(percorso) {
  if (!percorso) return;
  if (!finestra || finestra.webContents.isLoading()) {
    codaFile.push(percorso);
    return;
  }
  try {
    const dati = await readFile(percorso);
    finestra.webContents.send('apri-file', { nome: percorso.split(/[\\/]/).pop(), dati });
    if (finestra.isMinimized()) finestra.restore();
    finestra.focus();
  } catch (err) {
    dialog.showMessageBox(finestra, {
      type: 'error',
      title: 'File non leggibile',
      message: `Impossibile aprire «${percorso}».`,
      detail: err.message,
      buttons: ['Chiudi'],
    });
  }
}

async function scegliFile() {
  const r = await dialog.showOpenDialog(finestra, {
    title: 'Apri un file STEP',
    properties: ['openFile'],
    filters: [
      { name: 'File STEP', extensions: ESTENSIONI },
      { name: 'Tutti i file', extensions: ['*'] },
    ],
  });
  if (!r.canceled && r.filePaths[0]) await inviaFile(r.filePaths[0]);
}

/* ------------------------------------------------------------ protocollo */

/** Serve i file dell'app (dentro app.asar) e nulla al di fuori. */
async function serviFile(richiesta) {
  const url = new URL(richiesta.url);
  if (url.host !== 'app') return new Response('non trovato', { status: 404 });
  const relativo = normalize(decodeURIComponent(url.pathname)).replace(/^([\\/]|\.\.)+/, '');
  const percorso = join(RADICE, relativo || 'index.html');
  if (percorso !== RADICE && !percorso.startsWith(RADICE + sep)) {
    return new Response('accesso negato', { status: 403 });
  }
  const risposta = await net.fetch(pathToFileURL(percorso).toString(), { bypassCustomProtocolHandlers: true });
  if (!risposta.ok) return new Response('non trovato', { status: 404 });
  const estensione = percorso.slice(percorso.lastIndexOf('.')).toLowerCase();
  const intestazioni = new Headers(risposta.headers);
  intestazioni.set('Content-Type', TIPI[estensione] || 'application/octet-stream');
  intestazioni.set('Content-Security-Policy', CSP);
  intestazioni.set('X-Content-Type-Options', 'nosniff');
  return new Response(risposta.body, { status: 200, headers: intestazioni });
}

/* ---------------------------------------------------------------- finestra */

function creaFinestra() {
  finestra = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#15171c',
    title: app.getName(),
    icon: process.platform === 'linux' ? join(RADICE, 'build/icona.png') : undefined,
    webPreferences: {
      preload: join(RADICE, 'desktop/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: false,          // niente ispezione: l'app resta chiusa
      spellcheck: false,
    },
  });

  finestra.once('ready-to-show', () => {
    finestra.show();
    for (const f of codaFile.splice(0)) inviaFile(f);
  });

  // niente navigazione fuori dall'app: i collegamenti esterni vanno al sistema
  const esterno = (url) => /^(https?|mailto|tel):/i.test(url);
  finestra.webContents.on('will-navigate', (ev, url) => {
    if (url.startsWith(`${ORIGINE}/`)) return;
    ev.preventDefault();
    if (esterno(url)) shell.openExternal(url);
  });
  finestra.webContents.setWindowOpenHandler(({ url }) => {
    // il report stampabile si apre in una finestra vuota della stessa origine
    if (url === 'about:blank' || url === '') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1000,
          height: 900,
          backgroundColor: '#ffffff',
          autoHideMenuBar: true,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
        },
      };
    }
    if (esterno(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  finestra.webContents.on('before-input-event', (ev, input) => {
    // scorciatoie di ispezione disattivate anche come promemoria visivo
    const k = (input.key || '').toLowerCase();
    if (k === 'f12' || (input.control && input.shift && (k === 'i' || k === 'c' || k === 'j'))) ev.preventDefault();
  });

  // esportazioni: chiede sempre dove salvare
  finestra.webContents.session.on('will-download', (_ev, elemento) => {
    elemento.setSaveDialogOptions({
      title: 'Salva il file esportato',
      defaultPath: join(app.getPath('documents'), elemento.getFilename()),
      buttonLabel: 'Salva',
    });
  });

  finestra.on('closed', () => { finestra = null; });
  finestra.loadURL(`${ORIGINE}/index.html`);
}

/* ------------------------------------------------------------------ menu */

function creaMenu() {
  const mac = process.platform === 'darwin';
  const modello = [
    ...(mac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Apri file STEP…', accelerator: 'CmdOrCtrl+O', click: () => scegliFile() },
        { type: 'separator' },
        mac ? { role: 'close', label: 'Chiudi finestra' } : { role: 'quit', label: 'Esci' },
      ],
    },
    {
      label: 'Vista',
      submenu: [
        { role: 'togglefullscreen', label: 'Schermo intero' },
        { type: 'separator' },
        { role: 'zoomin', label: 'Ingrandisci interfaccia' },
        { role: 'zoomout', label: 'Riduci interfaccia' },
        { role: 'resetzoom', label: 'Dimensione normale' },
      ],
    },
    {
      label: 'Aiuto',
      submenu: [
        { label: 'Comandi e scorciatoie', accelerator: 'F1', click: () => finestra && finestra.webContents.send('mostra-aiuto') },
        { type: 'separator' },
        { label: `Scrivi a ${MARCHIO.nome}`, click: () => shell.openExternal(`mailto:${MARCHIO.email}`) },
        { label: `Telefona (${MARCHIO.telefono})`, click: () => shell.openExternal(`tel:${MARCHIO.telefono.replace(/[^+\d]/g, '')}`) },
        ...(mac ? [] : [{ type: 'separator' }, { label: `Informazioni su ${app.getName()}`, click: () => mostraInformazioni() }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(modello));
}

function mostraInformazioni() {
  dialog.showMessageBox(finestra, {
    type: 'info',
    title: `Informazioni su ${app.getName()}`,
    message: `${app.getName()} ${app.getVersion()}`,
    detail: `${MARCHIO.nome} — ${MARCHIO.ruolo}\n${MARCHIO.email}\n${MARCHIO.telefono}\n\n` +
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
    buttons: ['Chiudi'],
  });
}

/* ----------------------------------------------------------------- avvio */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_ev, argv) => {
    if (finestra) {
      if (finestra.isMinimized()) finestra.restore();
      finestra.focus();
    }
    inviaFile(fileDaArgomenti(argv));
  });

  // doppio clic su un .stp associato all'app (macOS)
  app.on('open-file', (ev, percorso) => {
    ev.preventDefault();
    inviaFile(percorso);
  });

  app.whenReady().then(() => {
    protocol.handle(SCHEMA, serviFile);
    creaMenu();
    creaFinestra();
    inviaFile(fileDaArgomenti(process.argv));
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) creaFinestra();
    });
  });

  ipcMain.handle('apri-dialogo', () => scegliFile());
  ipcMain.handle('informazioni', () => ({
    nome: app.getName(),
    versione: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    piattaforma: process.platform,
  }));
  ipcMain.handle('mostra-informazioni', () => mostraInformazioni());

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  // nessun permesso (fotocamera, posizione, notifiche…): l'app non ne usa
  app.on('web-contents-created', (_ev, contenuti) => {
    contenuti.session.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
  });
}
