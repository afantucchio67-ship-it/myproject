/**
 * Avvio dell'applicazione. Sta in un file (e non in uno script in linea nella
 * pagina) perche' l'app desktop applica una Content-Security-Policy severa:
 * niente script in linea.
 */
import { avvia } from './app.js';

avvia();
