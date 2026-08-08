// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Spark Match
// =============================================================================
// Pre-bundle de IdentityMigrateFunction
// =============================================================================
// migrate es la unica funcion que no puede usar `BuildMethod: esbuild`: su
// artefacto necesita los .sql de migrations/, que el builder de esbuild no
// sabe empaquetar. El handler los busca en runtime con
// `resolve(process.cwd(), 'migrations')`, y process.cwd() dentro de Lambda es
// /var/task -- por eso tienen que quedar en la raiz del artefacto.
//
// Por que no se hace desde el Makefile que invoca SAM:
// `CustomMakeBuilder` corre `CopySource` (copia el CodeUri a un scratch dir) y
// despues `MakeBuild` con cwd en ese scratch. Ahi no existe `../../`, no hay
// node_modules y no hay tsconfig.base.json, asi que esbuild no resuelve ni
// `@spark-match/shared/*` ni `node-pg-migrate`. Ese build nunca pudo funcionar
// en CI.
//
// Este script corre ANTES de `sam build`, desde la raiz del workspace, donde
// si resuelven las rutas y los paquetes. Deja el artefacto listo en
// contexts/identity/.build/migrate/
// y el Makefile se limita a copiarlo -- una operacion que si sobrevive al
// scratch dir porque la carpeta viaja dentro del CodeUri.
// =============================================================================

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'contexts', 'identity', '.build', 'migrate');

// El bundle sale en ESM y algunas dependencias CJS (node-pg-migrate, pg) llaman
// a `require` en runtime; sin este shim el modulo revienta con
// "require is not defined".
const BANNER =
  "import{createRequire as __sparkRequire}from'node:module';" +
  'const require=__sparkRequire(import.meta.url);';

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

await build({
  absWorkingDir: ROOT,
  entryPoints: [join(ROOT, 'contexts', 'identity', 'src', 'handlers', 'migrate.ts')],
  outfile: join(OUT_DIR, 'migrate.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external: ['pg-native'],
  banner: { js: BANNER },
  logLevel: 'info',
});

// Las migraciones van a la raiz del artefacto: el handler las lee con
// resolve(process.cwd(), 'migrations') y en Lambda cwd es /var/task.
cpSync(join(ROOT, 'migrations'), join(OUT_DIR, 'migrations'), { recursive: true });

console.log(`migrate empaquetado en ${OUT_DIR}`);
