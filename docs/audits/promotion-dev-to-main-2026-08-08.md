# Promoción `dev` → `main` — 2026-08-08

## TL;DR

Promoción de 5 commits de `dev` a `main`, motivada por un **fallo de control
de acceso**: hasta hoy, cualquiera que se registrase por el endpoint público
quedaba con `role = 'admin'` y podía listar todos los usuarios con su correo,
leer el log de auditoría completo —que guarda IP y user agent de los logins de
otras personas— y desactivar cuentas ajenas.

`main` no tiene ninguno de los cinco commits. Prod nunca se ha desplegado.

## Aprobación

```
promotion-approved-by: @ahincho on 2026-08-08 via chat
```

Confirmada explícitamente antes de abrir el PR, según §4.6 regla 1. El handle
se verificó, no se supuso: `ahincho` es quien mergeó los PRs #206, #207 y #208
de hoy y figura en el equipo `@spark-match/backend-devs`.

Path usado: **A** (squash-merge vía PR), la línea base operacional desde el
2026-08-04.

## Qué se promueve

| PR   | Commit    | Qué hace                                              |
| ---- | --------- | ----------------------------------------------------- |
| #204 | `1f1ef99` | Permitir disparar la suite de CI a mano               |
| #205 | `d456545` | Que registrarse deje de conceder rol de administrador |
| #206 | `d39fdf7` | Devolver el rol en las respuestas de login y registro |
| #207 | `4486960` | Aplicar las migraciones dentro del propio deploy      |
| #208 | `b1f98ef` | Endurecer ese paso para un primer arranque en frío    |

## Verificación previa

- **CI en `dev`**: los 15 checks en verde sobre `b1f98ef`.
- **Deploy a dev**: ejecutado y verde sobre `b1f98ef`.
- **Artefactos desplegados**, comprobados descargando el código de las Lambdas
  de dev: `register` escribe `SELF_REGISTRATION_ROLE = 'student'`; `login` y
  `register` incluyen `role: z.enum(['admin','student'])` en su salida.
- **RBAC probado contra dev** con un token de estudiante real:
  `GET /v1/users` → 403, `GET /v1/audit` → 403, `GET /v1/users/me` → 200.
- **Alertas**: 0 de Dependabot. La única de Code Scanning
  (`actions/unpinned-tag` sobre `aws-actions/setup-sam@v3`) se descartó como
  falsa alarma, coherente con la política de `AGENTS.md` §12.1 y con
  `tests/bats/no-sha-pinning.bats`, que **prohíbe** pinear por SHA. Es la misma
  familia de alertas ya documentada en `codeql-config-exclusion-2026-08-04.md`.

## Qué NO resuelve esta promoción

Se registra para que nadie lo descubra desplegando.

**Prod nacerá sin ningún administrador.** No es un efecto de las migraciones:
`infra/user-repository.ts` escribe `role: DEFAULT_ROLE` explícitamente en cada
INSERT, con `DEFAULT_ROLE = SELF_REGISTRATION_ROLE = 'student'`, así que el
DEFAULT de la columna no se consulta nunca. Y no hay camino por API para
conceder el rol: `handlers/update-user.ts` valida con `UpdateProfileInputSchema`
—solo `fullName` y `age`—, de modo que Zod descarta `role`; y `setRole` de
`infra/user-repository.ts` no tiene ningún llamador fuera de los tests.

La salida acordada es en dos pasos: `ftapara@unsa.edu.pe` se registra en prod
por el endpoint público, y una migración `006` la promueve en el siguiente
deploy. Esa migración **debe afirmarse a sí misma** con `RAISE EXCEPTION` si no
encuentra la fila: un `UPDATE ... WHERE email = '...'` que toque 0 filas es
indistinguible del éxito en todas las capas, incluida la de este pipeline.

**La base de datos de prod entra sin vía de recuperación.** `BackupRetentionPeriod=0`,
cero snapshots, sin PITR, `MultiAZ=false`, y ninguna de las 5 migraciones tiene
sección `Down`. Decisión explícita del owner el 2026-08-08 ("los backups no son
necesarios"), registrada aquí para que conste como decisión y no como olvido.

**Prod arrancará sin ninguna alarma de CloudWatch.**

## Riesgo conocido del primer deploy

El primer deploy de prod es un CREATE de stack completo, no un UPDATE. Dos
diferencias respecto a todo lo probado hasta ahora:

1. Las 12 Lambdas se crean **con** `VpcConfig` desde el minuto cero, en una VPC
   donde nunca ha existido una ENI de Lambda (0 interfaces en el histórico de
   `sg-0a34e0825ff704d6d`). Una función así nace en `State=Pending`. Por eso
   #208 añadió `aws lambda wait function-active-v2` antes de invocar.
2. Las 5 migraciones se aplican de golpe en una única transacción, contra una
   base vacía. Hasta hoy el paso solo se había ejercitado por el camino que no
   aplica nada.

Si `sam deploy` falla a mitad del CREATE, el stack queda en `ROLLBACK_COMPLETE`,
que **no admite update**: relanzar el workflow no arregla nada y hay que borrar
el stack a mano. Documentado en `docs/runbook.md` §1.3.

## Verificación posterior (§4.4)

```bash
git fetch origin
git diff --stat origin/main origin/dev
```

No saldrá vacío, y no es un fallo: `main` lleva el commit de release con
`CHANGELOG.md` y `.release-please-manifest.json` en 0.1.1 que `dev` no tiene.
Dejarlo limpio exige un back-sync `main` → `dev` posterior.
