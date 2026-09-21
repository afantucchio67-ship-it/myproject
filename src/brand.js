/**
 * Riferimenti del marchio: unico punto da modificare per nome, ruolo e contatti.
 * Compaiono nell'interfaccia (testata, schermata iniziale, barra di stato,
 * finestra Aiuto) e in tutte le esportazioni (report, immagini, STL, OBJ,
 * CSV, JSON).
 */
import { LOGO_DATA_URL } from './brand-logo.js';

export const MARCHIO = {
  nome: 'Antonio Fantucchio',
  ruolo: 'Software Engineer',
  email: 'a.fantucchio67@gmail.com',
  telefono: '+39 392 0021816',
  applicazione: 'Visualizzatore STEP',
  logo: LOGO_DATA_URL,
};

/** Collegamenti pronti per l'interfaccia. */
export const EMAIL_URL = `mailto:${MARCHIO.email}`;
export const TELEFONO_URL = `tel:${MARCHIO.telefono.replace(/[^+\d]/g, '')}`;

/** Riga di contatti su una sola linea (piè di pagina, intestazioni di file). */
export function rigaContatti(separatore = ' · ') {
  return [MARCHIO.nome, MARCHIO.ruolo, MARCHIO.email, MARCHIO.telefono].join(separatore);
}

/** Firma del generatore per i file esportati. */
export function firmaGeneratore() {
  return `${MARCHIO.applicazione} — ${MARCHIO.nome}`;
}
