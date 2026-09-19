import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const radice = new URL('..', import.meta.url).pathname;

test('la versione a file unico in dist/ è allineata ai sorgenti', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'step-build-'));
  for (const d of ['src', 'css']) cpSync(join(radice, d), join(tmp, d), { recursive: true });
  for (const f of ['index.html', 'build.mjs']) cpSync(join(radice, f), join(tmp, f));
  execFileSync(process.execPath, ['build.mjs'], { cwd: tmp, stdio: 'pipe' });
  const generato = readFileSync(join(tmp, 'dist/visualizzatore-step.html'), 'utf8');
  assert.ok(existsSync(join(radice, 'dist/visualizzatore-step.html')), 'dist/visualizzatore-step.html manca: esegui `npm run build`');
  const committato = readFileSync(join(radice, 'dist/visualizzatore-step.html'), 'utf8');
  assert.equal(committato, generato, 'dist/visualizzatore-step.html non aggiornato: esegui `npm run build`');
  // controlli di base sul contenuto
  assert.ok(generato.includes('__VISUALIZZATORE_FILE_UNICO'));
  assert.ok(generato.includes('parseStepAsync'), 'il file unico deve contenere la lettura a passi');
  assert.ok(!/import\s*\{[^}]*\}\s*from\s*['"]\.\.?\//.test(generato), 'nessun import relativo residuo');
});
