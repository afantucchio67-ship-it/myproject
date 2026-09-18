/**
 * Adattatore per riusare gli esportatori della UI dalla riga di comando
 * (gli esportatori non usano il DOM, solo funzioni pure).
 */

const numero = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);

export function reportJSONCli(model) {
  const albero = (n) => ({
    nome: n.nome,
    prodotto: n.prodotto,
    versione: n.versione,
    idDefinizione: n.id,
    elementiGeometrici: n.items.map((i) => i.item.id),
    figli: n.figli.map(albero),
  });
  return JSON.stringify(
    {
      file: model.nomeFileCaricato,
      intestazione: model.header,
      unita: model.units,
      prodotti: model.prodotti,
      assieme: model.assieme.map(albero),
      parti: model.parti.map((p) => ({
        nome: p.nome,
        percorso: p.percorso,
        tipo: p.tipo,
        idEntita: p.id,
        triangoli: p.mesh.indices.length / 3,
        area: numero(p.area),
        volume: numero(p.volume),
        volumeEsatto: p.volumeEsatto,
        volumeAffidabile: p.volumeAffidabile,
        bordiAperti: p.bordiAperti,
        chiusa: p.chiusa,
        centroide: p.centroide.map(numero),
        bbox: { min: p.bbox.min.map(numero), max: p.bbox.max.map(numero), dimensioni: p.bbox.size.map(numero) },
        facce: p.facce.map((f) => ({
          id: f.id,
          tipoSuperficie: f.tipoSuperficie,
          area: numero(f.area),
          triangoli: f.triangoli,
          info: f.infoSuperficie || undefined,
        })),
        matrice: p.matrice.map(numero),
      })),
      boundingBoxGlobale: {
        min: model.bbox.min.map(numero),
        max: model.bbox.max.map(numero),
        dimensioni: model.bbox.size.map(numero),
      },
      proprieta: model.proprieta,
      organizzazione: model.organizzazione,
      layer: model.layer,
      riepilogoGeometria: model.geometria,
      statistiche: model.statistiche,
      conteggiTipiEntita: model.conteggiTipi,
      diagnostica: model.diagnostics,
    },
    null,
    2,
  );
}

function csv(righe) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return righe.map((r) => r.map(esc).join(';')).join('\r\n');
}

export function csvCli(model, quale) {
  if (quale === 'entita') {
    return csv([['tipo_entita', 'conteggio'], ...model.conteggiTipi.map((t) => [t.type, t.count])]);
  }
  if (quale === 'facce') {
    const righe = [['parte', 'percorso', 'id_faccia', 'tipo_superficie', 'area_mm2', 'triangoli', 'dettagli']];
    for (const p of model.parti) {
      for (const f of p.facce) {
        righe.push([p.nome, p.percorso, f.id, f.tipoSuperficie, numero(f.area), f.triangoli,
          f.infoSuperficie ? JSON.stringify(f.infoSuperficie) : '']);
      }
    }
    return csv(righe);
  }
  const righe = [[
    'parte', 'percorso', 'tipo', 'id', 'facce', 'triangoli', 'area_mm2', 'volume_mm3',
    'chiusa', 'volume_esatto', 'bordi_aperti', 'dx', 'dy', 'dz', 'cx', 'cy', 'cz',
  ]];
  for (const p of model.parti) {
    righe.push([p.nome, p.percorso, p.tipo, p.id, p.facce.length, p.mesh.indices.length / 3,
      numero(p.area), numero(p.volume), p.chiusa ? 'si' : 'no',
      p.volumeEsatto ? 'si' : 'no', p.bordiAperti,
      ...p.bbox.size.map(numero), ...p.centroide.map(numero)]);
  }
  return csv(righe);
}
