# Visualizzatore STEP — geometria e dati

Applicazione web che apre file **STEP** (`.stp`, `.step`, ISO 10303-21) e ne mostra
tutto il contenuto: il modello **3D** navigabile e i **dati** presenti nel file
(intestazione, unità, struttura di assieme, prodotti, proprietà, persone e
approvazioni, misure, elenco completo delle entità).

Funziona **interamente nel browser**: nessun caricamento su server, nessuna
dipendenza esterna. Parser STEP, tassellatore BREP e renderer WebGL sono scritti
da zero in questo repository.

## Due modi per usarlo

**A) File unico, senza installare nulla** — `dist/visualizzatore-step.html`:
scaricalo e aprilo con un doppio clic, poi trascina dentro il file `.stp`.
Contiene già tutto (HTML, CSS e codice) e funziona anche senza rete. Si
rigenera con `node build.mjs`.

**B) Con il server locale** (consigliato per file grandi: la lettura avviene
in un web worker e l'interfaccia resta sempre reattiva):

```
node server.mjs          # avvia su http://localhost:8080
```

Poi trascina un file `.stp` nella pagina (oppure usa *Apri file…*).

## Cosa mostra

**Grafica**
- solido ombreggiato, spigoli del modello (i veri spigoli BREP, non i lati dei triangoli), wireframe
- rotazione, spostamento, zoom verso il puntatore, viste standard (tasti `0`–`6`), inquadratura automatica (`f`)
- proiezione prospettica oppure ortogonale
- trasparenza regolabile, ingombro, assi
- **piano di sezione** su X, Y o Z con posizione continua
- **clic su una faccia**: mostra entità, tipo di superficie, raggio/asse/grado, area
- **misura** distanza tra due punti presi sul modello (tasto `m`)
- visibilità e isolamento delle singole parti

**Dati**
- *Struttura*: albero di assieme (`NEXT_ASSEMBLY_USAGE_OCCURRENCE` con le trasformazioni), parti, facce
- *Dati*: intestazione del file, unità e incertezza dichiarata, prodotti e categorie, proprietà
  (`PROPERTY_DEFINITION`, `GENERAL_PROPERTY`, testo descrittivo), persone/organizzazioni con i ruoli,
  approvazioni, date, classificazione, livelli di presentazione
- *Geometria*: ingombro, area, volume, centroide, tenuta della mesh, conteggi di solidi/facce/spigoli
  e tipi di superficie
- *Entità*: conteggio per tipo e **esploratore**: ricerca per `#id`, per tipo o per testo, con
  navigazione fra i riferimenti (`riferimenti` / `citata da`)
- *Diagnostica*: tempi di lettura e segnalazioni (facce non tassellabili, gusci orientati al contrario,
  mesh non a tenuta)

**Esportazioni**: report JSON completo, CSV di parti / facce / entità, mesh STL e OBJ, immagine PNG.

## Riga di comando

Stesso motore, senza browser — utile per controlli rapidi o in blocco:

```
node bin/step-report.mjs modello.stp                  # riepilogo leggibile
node bin/step-report.mjs modello.stp --json           # report completo JSON
node bin/step-report.mjs modello.stp --csv facce      # CSV (facce | parti | entita)
node bin/step-report.mjs *.stp --tolleranza 0.03      # qualità di tassellazione
```

Esempio di riepilogo:

```
=== forma.stp ===
schema            : CONFIG_CONTROL_DESIGN
unità             : MILLIMETRE / radian · incertezza 0.001
entità            : 6556 (78 tipi) in 53 ms
ingombro          : 53,58 × 77,15 × 118,65 mm
area / volume     : 10.051,8 mm² / 25.022,6 mm³

struttura:
  Rico 85 03 c7 + randa
    Spina 5 — 1 geom.
    Rico 80 03 sop pelle — 1 geom.
    Rico 80 03 c7 cs — 1 geom.
```

## Come è fatto

```
index.html              pagina e barra dei comandi
css/app.css             tema chiaro/scuro
src/step/parser.js      lettore ISO 10303-21 (entità, record complessi, stringhe estese, indici inversi)
src/step/geometry.js    curve e superfici: linee, cerchi, ellissi, B-spline/NURBS, piani, cilindri,
                        coni, sfere, tori, offset, estrusioni, rivoluzioni; proiezione punto→(u,v)
src/step/tessellate.js  da BREP a triangoli: campionamento spigoli, triangolazione, suddivisione
src/step/model.js       livello semantico: intestazione, unità, assieme, misure, proprietà, statistiche
src/viewer/             matrici, camera orbitale, renderer WebGL, selezione a raggio (CPU)
src/worker/             lettura e tassellazione in un web worker (interfaccia sempre reattiva)
src/ui/                 pannelli dati, esportazioni, applicazione
bin/step-report.mjs     report da riga di comando
build.mjs               genera la versione a file unico in dist/
test/                   test automatici con geometrie di riferimento
```

### Note sulla tassellazione

Il passaggio da BREP a triangoli è la parte delicata. Qui è risolto così:

1. gli spigoli sono campionati dalle curve con errore di corda controllato;
2. i punti del contorno sono proiettati nello spazio parametrico della superficie in modo
   **sequenziale** (Gauss-Newton partendo dal punto precedente), per non saltare su altri rami
   nelle superfici che si ripiegano;
3. lo spazio `(u,v)` è **riscalato con la metrica locale**: senza questo, parametrizzazioni molto
   anisotrope (rapporti anche 1:2000, frequenti nei raccordi) rovinano la triangolazione;
4. il poligono è triangolato per *ear clipping* scegliendo l'orecchio **di qualità migliore**
   (lato più lungo minimo) e poi migliorato con scambi di Delaunay;
5. i triangoli sono suddivisi in modo uniforme fino a rientrare nella tolleranza; le facce di uno
   stesso solido usano lo stesso livello e i punti di bordo restano sulle corde condivise, così le
   facce adiacenti combaciano e la mesh resta **a tenuta**;
6. le facce periodiche complete (fori, perni) sono cucite fra i due contorni;
7. il verso dei triangoli è allineato alle normali analitiche; un guscio orientato verso l'interno
   viene corretto e segnalato.

Area e volume sono calcolati sulla mesh. Il volume è indicato come esatto quando la mesh è chiusa,
approssimato (`≈`) quando restano pochi bordi aperti, `n.d.` quando il valore non è attendibile: il
numero di bordi aperti è sempre riportato in *Geometria* e in *Diagnostica*.

I test verificano le misure su geometrie note (cubo: area 600 mm² e volume 1000 mm³ esatti;
cilindro: entro l'1% dai valori analitici, mesh chiusa).

## Limiti noti

- schemi supportati: AP203 / AP214 / AP242 con BREP avanzato, modelli a gusci e insiemi di curve.
  Le entità di quotatura e tolleranza (PMI/GD&T di AP242) sono elencate fra le entità ma non disegnate.
- superfici non ancora tassellate: `SURFACE_OF_REVOLUTION` con contorni che attraversano la cucitura
  e poche varianti rare; le facce non tassellabili sono segnalate in *Diagnostica* e non bloccano il resto.
- file compressi (`.stpz`) e allegati binari non sono gestiti.
- i file molto grandi (oltre ~100 MB) restano vincolati alla memoria del browser.

## Requisiti

Node.js 18+ per il server statico e la riga di comando; un browser con WebGL
(Chrome, Edge, Firefox, Safari recenti). Nessuna installazione di pacchetti.

```
npm test        # 19 test automatici
```
