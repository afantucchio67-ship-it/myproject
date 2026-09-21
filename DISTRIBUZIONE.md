# Distribuire il Visualizzatore STEP come app

**Antonio Fantucchio** — Software Engineer
[a.fantucchio67@gmail.com](mailto:a.fantucchio67@gmail.com) · +39 392 0021816

L'app desktop è la stessa applicazione, chiusa dentro un eseguibile: il codice
finisce in un archivio compilato (`app.asar`) e l'eseguibile rifiuta di partire
se qualcuno lo modifica. Non serve installare Node, non serve un browser, non
serve la rete.

## 1. Cosa si consegna al cliente

| Sistema | File | Come si usa |
|---|---|---|
| Windows 10/11 (64 bit) | `Visualizzatore STEP-<ver>-installatore.exe` | doppio clic, installa per l'utente corrente (nessun diritto di amministratore), crea le icone su desktop e menu Start |
| Windows, senza installare | `Visualizzatore STEP-<ver>-portatile.exe` | un file unico: doppio clic e parte (anche da chiavetta) |
| Windows, rete aziendale | `Visualizzatore STEP-<ver>-x64.zip` | si scompatta in una cartella e si lancia `Visualizzatore STEP.exe` |
| macOS Apple Silicon (M1…M4) | `Visualizzatore STEP-<ver>-arm64.dmg` | si apre e si trascina l'app in Applicazioni |
| macOS Intel | `Visualizzatore STEP-<ver>-x64.dmg` | idem |
| Linux | `Visualizzatore STEP-<ver>-x86_64.AppImage` | si rende eseguibile e si lancia |

Tutti i pacchetti contengono l'app completa: geometria 3D, dati del file,
misure, sezioni, esportazioni (STL, OBJ, CSV, JSON, PNG, report stampabile) e
il marchio con i riferimenti.

## 2. Come si compila

```
npm ci            # una volta: scarica Electron e gli strumenti
npm run app:win   # Windows: installatore + portatile + zip   → dist-app/
npm run app:mac   # macOS: dmg e zip (Intel e Apple Silicon)   → dist-app/
npm run app:linux # Linux: AppImage                            → dist-app/
npm run app       # avvia l'app senza impacchettarla (prova veloce)
```

**Regola importante:** ogni sistema si compila sul sistema corrispondente.
- **macOS va compilato su macOS**: solo lì l'app viene firmata, e senza firma
  le app per Apple Silicon non partono affatto.
- **Windows** si compila su Windows (oppure su Linux con `wine` installato, che
  è il modo usato per i pacchetti già presenti in questo repository).

Se non hai un Mac, usa GitHub Actions: è già configurato.

### Compilazione automatica su GitHub (consigliata)

Il workflow `.github/workflows/app-desktop.yml` compila **Windows su Windows** e
**macOS su macOS**, esegue prima test e lint, e allega i pacchetti:

- **a mano**: repository → *Actions* → *App desktop* → *Run workflow*. I file si
  scaricano dagli *Artifacts* della sessione (30 giorni).
- **con una versione**: alza il numero in `package.json` e pubblica il tag

  ```
  git tag v1.0.1 && git push origin v1.0.1
  ```

  A fine build trovi una *Release* di GitHub con tutti i pacchetti pronti da
  passare ai clienti tramite link.

## 3. «Non modificabile»: cosa fa l'app, in concreto

| Protezione | Effetto |
|---|---|
| Codice in `app.asar` | l'applicazione non gira da file sorgente sparsi: è un archivio unico compilato dentro l'eseguibile |
| `OnlyLoadAppFromAsar` | l'eseguibile carica **solo** quell'archivio: non si può affiancargli una cartella con codice modificato |
| `EnableEmbeddedAsarIntegrityValidation` | l'impronta dell'archivio è incisa nell'eseguibile: se l'archivio viene toccato, **l'app non parte** (Windows e macOS) |
| `RunAsNode` disattivato | l'eseguibile non può essere usato come interprete per eseguire codice altrui |
| `NODE_OPTIONS` e `--inspect` disattivati | non si può iniettare codice né agganciare un debugger all'app |
| Strumenti di sviluppo disattivati | niente ispezione della pagina, niente console, niente «ricarica» |
| Sandbox e isolamento del contesto | la parte grafica non ha accesso al file system né a Node |
| Content-Security-Policy severa | l'app carica solo il proprio codice: nessuno script esterno, nessuna chiamata in rete |

Verifica fatta sui pacchetti prodotti (`npx @electron/fuses read --app <app>`):

```
RunAsNode                            Disabled
EnableCookieEncryption               Enabled
EnableNodeOptionsEnvironmentVariable Disabled
EnableNodeCliInspectArguments        Disabled
EnableEmbeddedAsarIntegrityValidation Enabled
OnlyLoadAppFromAsar                  Enabled
GrantFileProtocolExtraPrivileges     Disabled
```

**Cosa questo non è.** Nessuna app desktop (né la nostra, né quelle dei grandi
marchi) è impossibile da smontare: chi ha il file sul proprio computer può
sempre analizzarlo. Quello che si ottiene è che **una modifica rompe l'app** e,
con la firma del codice, diventa anche **riconoscibile**: il cliente vede
subito che il file non è più quello firmato da te. Se serve alzare ancora
l'asticella si può aggiungere un passaggio di offuscamento del codice prima
dell'impacchettamento: dillo e lo aggiungo al build.

## 4. Firma del codice (raccomandata per i clienti)

Senza firma l'app funziona, ma i sistemi avvisano l'utente:

- **Windows**: SmartScreen mostra «Windows ha protetto il PC» → *Ulteriori
  informazioni* → *Esegui comunque*.
- **macOS**: al primo avvio serve **tasto destro sull'app → Apri** (una volta
  sola), oppure *Impostazioni di Sistema → Privacy e sicurezza → Apri comunque*.

Con la firma questi avvisi spariscono (su Windows del tutto con un certificato
EV o dopo che il certificato si è «fatto una reputazione»).

**Windows** — serve un certificato di *code signing* (OV o EV) da una CA
(indicativamente 200–600 €/anno; i certificati EV richiedono un token
hardware). Poi:

```
# in locale (PowerShell)
$env:CSC_LINK="C:\percorso\certificato.pfx"; $env:CSC_KEY_PASSWORD="…"; npm run app:win
```

In GitHub Actions basta aggiungere i segreti `WINDOWS_CERT_BASE64` (il .pfx
codificato in base64) e `WINDOWS_CERT_PASSWORD`: il workflow li usa già.

**macOS** — serve l'iscrizione all'Apple Developer Program (99 $/anno), un
certificato *Developer ID Application* e la *notarizzazione*. Segreti da
aggiungere: `APPLE_CERT_BASE64`, `APPLE_CERT_PASSWORD`, `APPLE_ID`,
`APPLE_APP_PASSWORD` (password per app), `APPLE_TEAM_ID`. Poi attiva la
notarizzazione aggiungendo in `electron-builder.yml`:

```yaml
mac:
  notarize:
    teamId: IL_TUO_TEAM_ID
```

## 5. Aggiornare l'app

1. Modifica il codice e verifica: `npm test`, `npm run lint`.
2. Alza la versione in `package.json` (es. `1.0.1`).
3. `git tag v1.0.1 && git push origin v1.0.1` → i pacchetti nuovi arrivano nella
   Release.
4. Passa al cliente il nuovo installatore: sovrascrive la versione precedente.

Per cambiare **logo o riferimenti** vedi la sezione «Marchio e riferimenti» del
README: si aggiornano in un punto solo e l'app li riprende (icona compresa,
con `npm run icone`).

## 6. Domande dei clienti, risposte pronte

- *«Serve internet?»* No. L'app non fa nessuna chiamata in rete: la CSP la
  vieta e non c'è nessun servizio da contattare.
- *«I miei file vengono caricati da qualche parte?»* No: restano sul computer,
  l'app li legge in locale.
- *«Serve installare altro?»* No: né Node, né browser, né librerie CAD.
- *«Occupa molto?»* Circa 300 MB installata (contiene il motore grafico).
- *«Funziona su Windows 7 / macOS vecchi?»* Serve Windows 10 o 11 e macOS 11
  (Big Sur) o successivo.
