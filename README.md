# Visualizzatore STEP — geometria e dati

Applicazione per aprire file **STEP** (`.stp`, `.step`, ISO 10303-21) e leggerne
tutto il contenuto: il modello **3D** navigabile e i **dati** presenti nel file
(intestazione, unità, struttura di assieme, prodotti, proprietà, persone e
approvazioni, misure, elenco completo delle entità).

Funziona **interamente nel browser**: nessun caricamento su server, nessuna
dipendenza esterna. Parser STEP, tassellatore BREP e renderer WebGL sono scritti
da zero in questo repository. I file restano sul computer di chi li apre.

## Due modi per usarlo

**A) File unico, senza installare nulla** — `dist/visualizzatore-step.html`:
scaricalo e aprilo con un doppio clic, poi trascina dentro il file `.stp`.
Contiene già tutto (HTML, CSS e codice) e funziona anche senza rete.

**B) Con il server locale** (consigliato per i file grandi: la lettura avviene
in un web worker e l'interfaccia resta sempre reattiva). Serve solo Node.js 18+:

```
node server.mjs            # http://localhost:8080  (solo questo computer)
node server.mjs 8080 --rete   # raggiungibile anche dagli altri dispositivi della rete
```

Su Windows basta un doppio clic su `avvia.bat`. Il server non serve mai file o
cartelle nascosti (`.git` ecc.).

## Cosa fa

**Grafica**
- solido ombreggiato, spigoli del modello (i veri spigoli BREP), wireframe;
  prospettiva o ortogonale; trasparenza; assi e ingombro
- rotazione, spostamento, zoom verso il puntatore (anche con pizzico su
  touch), viste standard (`0`–`6`), inquadra tutto (`F`) o la selezione
  (`Maiusc+F`), vista normale alla faccia selezionata
- **clic su una faccia**: entità, tipo di superficie, raggio/asse/grado, area;
  suggerimento con coordinate al passaggio del mouse
- **misura** (`M`): distanza fra due punti agganciati ai vertici, con punti,
  segmento ed etichetta disegnati sul modello, copia negli appunti
- **piano di sezione** (`S`) su X, Y o Z con quota, inversione, azzeramento e
  contorno del piano visibile
- **esplosione** dell'assieme, colore e visibilità per parte, isolamento
- selezione sincronizzata: clic in 3D, nell'albero o nelle tabelle evidenzia
  ovunque; doppio clic inquadra

**Dati** (pannello laterale ridimensionabile, con filtro nell'albero)
- *Struttura*: albero di assieme (`NEXT_ASSEMBLY_USAGE_OCCURRENCE` con le
  trasformazioni applicate), parti con colore e visibilità, facce della parte
- *Dati*: intestazione del file, unità e incertezza, prodotti, proprietà
  (`PROPERTY_DEFINITION`, `GENERAL_PROPERTY`, testo descrittivo), persone e
  organizzazioni con i ruoli, approvazioni, date, classificazione, livelli
- *Geometria*: ingombro, area, volume, centroide, tenuta della mesh, conteggi
  di solidi, facce, spigoli e tipi di superficie
- *Entità*: conteggio per tipo ed **esploratore**: ricerca per `#id`, tipo o
  testo, navigazione fra riferimenti, evidenziazione nel 3D
- *Diagnostica*: tempi, segnalazioni (facce non tassellabili, gusci orientati
  al contrario, mesh non a tenuta), con contatore sulla scheda

**Esportazioni**: report JSON completo, CSV di parti / facce / entità (BOM e
`;`, pronti per Excel), **report stampabile / PDF**, mesh STL binario o ASCII e
OBJ+MTL con i colori (solo parti visibili), PNG come a schermo o ad alta
risoluzione con sfondo bianco o trasparente.

Tema chiaro/scuro, qualità di tassellazione, modo di vista, proiezione e
larghezza del pannello vengono ricordati. `?` mostra tutte le scorciatoie.

## Riga di comando

Stesso motore, senza browser — per controlli rapidi o in blocco:

```
node bin/step-report.mjs modello.stp                  # riepilogo leggibile
node bin/step-report.mjs modello.stp --json           # report completo JSON
node bin/step-report.mjs modello.stp --csv facce      # CSV (facce | parti | entita)
node bin/step-report.mjs *.stp --tolleranza 0.03      # qualità di tassellazione (mm)
```

Il codice di uscita è diverso da zero se un file non è leggibile o non è STEP.

## Come è fatto

```
index.html, css/app.css   pagina, barra dei comandi a nastro, tema chiaro/scuro
src/step/parser.js        lettore ISO 10303-21 (record complessi, stringhe estese,
                          numeri "10." e "1.E-3", indici inversi, lettura a passi)
src/step/geometry.js      curve e superfici: linee, cerchi, ellissi, B-spline/NURBS anche
                          in record complessi, piani, cilindri, coni, sfere, tori, offset,
                          estrusioni, rivoluzioni; proiezione punto → (u,v)
src/step/tessellate.js    da BREP a triangoli (vedi sotto)
src/step/model.js         livello semantico: intestazione, unità (anche pollici e gradi),
                          assieme con trasformazioni, misure, proprietà, statistiche
src/step/esploratore.js   ricerca e scheda delle entità (usato da worker e pagina)
src/viewer/               matrici, camera orbitale, renderer WebGL, selezione a griglia
src/worker/               lettura e tassellazione in un web worker
src/ui/                   pannelli, esportazioni, applicazione
bin/step-report.mjs       report da riga di comando
build.mjs                 genera la versione a file unico in dist/
test/                     test automatici (motore, geometrie di riferimento, esportazioni, viewer)
```

### Tassellazione

1. Gli spigoli sono campionati dalle curve con errore di corda controllato;
   i `VERTEX_LOOP` diventano apici e le cuciture (stesso spigolo due volte nel
   loop, stile OpenCascade/FreeCAD) spezzano il loop negli anelli reali.
2. I punti sono proiettati nello spazio parametrico in modo **sequenziale**
   (Gauss-Newton dal punto precedente) e lo spazio `(u,v)` è **riscalato con
   la metrica locale**: senza questo, parametrizzazioni anisotrope (anche
   1:2000 nei raccordi) rovinano la triangolazione.
3. Facce rigate periodiche (cilindri, coni, estrusioni, rivoluzioni) con due
   anelli sono cucite direttamente fra i bordi; con un apice si usa un
   ventaglio; sfere e tori una griglia il cui intervallo `v` segue
   l'orientamento del contorno.
4. Le altre facce: ear clipping scegliendo l'orecchio **di qualità migliore**,
   scambi di Delaunay, suddivisione uniforme con i bordi sulle corde condivise
   (le facce di uno stesso solido usano lo stesso livello): la mesh resta a
   tenuta.
5. Il verso dei triangoli è allineato alle normali analitiche; un guscio
   chiuso orientato verso l'interno viene corretto e segnalato.

Area e volume sono calcolati sulla mesh. Il volume è esatto quando la mesh è
chiusa, approssimato (`≈`) con pochi bordi aperti, `n.d.` quando non è
attendibile; il numero di bordi aperti è sempre riportato.

## Test

```
npm test        # 70 casi, senza dipendenze
npm run lint    # eslint (installato globalmente: npx eslint@9 se manca)
npm run build   # rigenera dist/visualizzatore-step.html (un test controlla che sia aggiornato)
```

I test coprono parser, geometria, esportazioni, viewer e **34 geometrie di
riferimento** con valori analitici (cubo, cilindro, coni, sfere, tori, fori,
cuciture, gusci invertiti, vuoti, B-spline razionali, rivoluzioni, gradi,
pollici, assiemi): area e volume entro l'1 %, mesh chiuse.

## Limiti noti

- Schemi supportati: AP203 / AP214 / AP242 con BREP avanzato o sfaccettato,
  modelli a gusci e insiemi di curve. Quote e tolleranze (PMI/GD&T di AP242)
  sono elencate fra le entità ma non disegnate.
- Colori: `STYLED_ITEM`/`COLOUR_RGB` per parte; niente texture.
- File compressi (`.stpz`) non gestiti.
- Con migliaia di parti i pannelli si ricostruiscono a ogni selezione: resta
  usabile ma non istantaneo.
