# 2026-08-04 — SonarCloud binding fix

## Status

**DEFERRED**. The diagnostic was completed (see below) but the
admin-side fix in SonarCloud UI is parked. Smoke test PR #150
(`chore/smoke-test-sonar-binding`) is the work item to resume
when the binding fix is picked up.

## Resumen

SonarCloud project `spark-match-03-backend` (en la org `ahincho` de SonarCloud)
estaba bindeado al GitHub repository `ahincho/orion-backend` — un repo
deprecated de la era pre-rebrand. El nuevo repo `spark-match/spark-match-03-backend`
(org `spark-match`) **no aparecía en el dropdown** porque el SonarQube GitHub App
solo estaba instalado en la user account `ahincho`, no en la org `spark-match`.

### Por qué pasó

Cronología reconstruida:

| Fecha (UTC)         | Evento                                                  |
|---------------------|---------------------------------------------------------|
| 2026-06-27 19:33    | `spark-match/spark-match-03-backend` creado en GitHub   |
| 2026-06-30 22:37    | `ahincho/orion-backend` creado (donde se desarrollaba)  |
| 2026-07-25 16:44    | SonarCloud project `spark-match-03-backend` creado      |
| 2026-07-25 19:21    | `SONAR_PROJECT_KEY=spark-match-03-backend` seteado      |
| 2026-07-25 ~21:00   | **GitHub App instalado SOLO en `ahincho`**             |
| 2026-07-25 21:48    | `SONAR_FAIL_ON_QUALITY_GATE=true` a nivel de org       |
| 2026-07-26 ~        | Rebrand parcial: se migra dev a `spark-match-03-backend` |
| 2026-07-26 15:45    | Último commit significativo en `ahincho/orion-backend` |
| 2026-07-30 16:01    | `SONAR_SOURCES=contexts,shared,layers,scripts` actualizado |
| 2026-08-03 ~        | Scanner del nuevo repo empieza a pushear análisis      |
| 2026-08-04 13:09    | Primera analysis `main` con revision `c12b23a` (nuestra) |
| 2026-08-04 ~        | Diagnóstico + smoke test deferred                      |

**El rebrand fue parcial**. El equipo actualizó las GitHub vars (`SONAR_PROJECT_KEY`,
`SONAR_SOURCES`, `SONAR_TESTS`) para apuntar al nuevo repo, pero **NO**:

1. Instaló el SonarQube GitHub App en la org `spark-match` (solo estaba en `ahincho`).
2. Re-bindeó el proyecto SonarCloud al nuevo repo.

### Distinción crítica entre GitHub Apps

| GitHub App | Dónde está instalada | Qué hace |
|---|---|---|
| `spark-match-bot` | Org `spark-match` ✅ | Bot para release-please |
| **SonarQube Cloud** | **Solo user `ahincho`** ❌ | SonarCloud PR decoration |

Verificado vía `gh api orgs/spark-match/installations`. La org `spark-match`
solo tiene `spark-match-bot` instalado; el SonarQube Cloud GH App está
solo en el user `ahincho`. Por eso el dropdown de SonarCloud UI solo
lista repos `ahincho/*`.

### Síntoma

Cada PR nuevo en `spark-match/spark-match-03-backend` (PR #134–#150)
fallaba en el job `sonar / sonar-typescript-ci` con:

```
ERROR: Could not find the pullrequest with key '<N>'
```

Razón: SonarCloud buscaba PR N en `ahincho/orion-backend` (donde existe
PR #132 = "ci(deps): bump aws-powertools...") — no en
`spark-match-03-backend` (donde existe PR #132 = "feat(ci): add
node-test PR gate..."). Mismo número, distintos repos.

Verificado:
```bash
gh api -H "Accept: application/json" \
  "https://sonarcloud.io/api/navigation/component?component=spark-match-03-backend"
# "alm": {"key": "github", "url": "https://github.com/ahincho/orion-backend"}
```

### Impacto

- ✅ Branch analyses (main, dev): funcionaban. El scanner pusha al project key
  correcto y SonarCloud almacena sin chequear el ALM binding.
- ✅ Métricas (coverage 91.0%, branch_coverage 85.7%, code_smells=0): correctas.
- ❌ PR decoration: falla. No se podía decorar PRs con findings de SonarCloud.
- ❌ Quality gate enforcement en PRs: admin-bypass manual en cada PR.

Workaround aplicado: admin-bypass documentado en PR #134–#149. Una vez
hecho el fix, el bypass deja de ser necesario.

## Fix a ejecutar (cuando se retome)

### Paso 1 — Instalar el SonarQube GitHub App en la org `spark-match`

URL: https://github.com/apps/sonarcloud-cloud/installations/new

1. Selecciona la org **`spark-match`**.
2. **"Repository access"**: "Only select repositories" → marca
   `spark-match/spark-match-03-backend` (más seguro que "All").
3. Click **Install & Authorize**.

### Paso 2 — Re-bind en SonarCloud UI

En https://sonarcloud.io/dashboard?id=spark-match-03-backend:

1. Administration → General Settings → Repository binding.
2. **Refresca** la página (F5) — el dropdown ahora debe listar
   `spark-match/spark-match-03-backend`.
3. Selecciónalo y **Save**.

### Paso 3 — Verificación

```bash
gh api -H "Accept: application/json" \
  "https://sonarcloud.io/api/navigation/component?component=spark-match-03-backend"
```

Debe devolver `"url": "https://github.com/spark-match/spark-match-03-backend"`.

### Paso 4 — Smoke test (resume PR #150)

PR #150 (`chore/smoke-test-sonar-binding`) tiene un cambio trivial en
`package.json` que dispara el CI. Re-trigger (close+reopen, o push vacío):

```bash
git commit --allow-empty -m "chore: re-trigger CI after binding fix"
git push
```

Si `sonar / sonar-typescript-ci` pasa en verde sin admin-bypass, el
fix está completo. Mergear PR #150 con la nota de smoke-test exitoso.

### Paso 5 (fallback) — Crear proyecto nuevo si Paso 2 no funciona

Si después del Paso 1 el dropdown sigue sin listar `spark-match/*` (porque
el SonarCloud org `ahincho` está bindeado al GitHub user, no a la org),
entonces:

1. https://sonarcloud.io/projects/create → GitHub repositories → seleccionar
   `spark-match/spark-match-03-backend`.
2. Project key: `spark-match_03_backend` (o `spark-match-03-backend-v2`).
3. Quality Gate: `Spark Match Way`.
4. Update `SONAR_PROJECT_KEY` var en nuestro repo:
   ```bash
   gh variable set SONAR_PROJECT_KEY --repo spark-match/spark-match-03-backend --body "spark-match_03_backend"
   ```

## Lecciones aprendidas

### Lección 1 — Checklist de rebrand cross-repo

Cuando un equipo migra código de un GitHub repo a otro (org diferente,
namespace diferente, etc.), el checklist de platform setup debe incluir:

- [ ] GitHub vars/secrets actualizados (`SONAR_PROJECT_KEY`, etc.).
- [ ] **GitHub App re-instalada en el nuevo repo/org** (no basta con cambiar vars).
- [ ] **ALM binding re-hecho** en cada proyecto SonarCloud.
- [ ] **PR de prueba** que verifique end-to-end (analysis + PR decoration).
- [ ] **Cleanup** del proyecto SonarCloud antiguo (archive, no delete, para
      preservar historial de análisis).

### Lección 2 — Validación end-to-end

Las branch analyses pueden pasar aunque el PR decoration falle. El smoke
test debe abrir un PR real y verificar el job `sonar-typescript-ci`.
No basta con verificar métricas en el dashboard.

### Lección 3 — Admin-bypass tiene que ser documentado y limitado

Durante el periodo del bug (PR #134–#149), el admin-bypass en
`sonar-typescript-ci` estuvo documentado en cada PR comment y commit
body. Esto permitió mantener la cadencia de merges sin bloquear la
entrega, mientras se diagnosticaba el issue.

El admin-bypass NO se usó en checks que sí funcionaban (CodeQL, eslint,
gitleaks, migrations-dry-run, node-test, node-typecheck, yamllinks,
commitlint, actionlint).

### Lección 4 — Diagnosticar vía MCP antes de asumir

Sin acceso a SonarCloud via MCP, este issue habría requerido mucho
más tiempo de debugging manual. El endpoint
`GET /api/navigation/component?component=<key>` devuelve el campo
`alm.url` que identifica el binding actual directamente.

## Estado al cierre (2026-08-04)

- ✅ Diagnóstico completo.
- ✅ Cronología reconstruida (10 eventos).
- ✅ 5 pasos del fix documentados.
- ❌ Fix NO ejecutado (admin task deferred).
- ✅ Smoke test branch (`chore/smoke-test-sonar-binding`, PR #150)
       listo para re-trigger cuando el fix se ejecute.
- ✅ Workaround admin-bypass activo y documentado en PR #134–#149.

## Referencias

- SonarCloud project: `https://sonarcloud.io/dashboard?id=spark-match-03-backend`
- SonarCloud QG: `https://sonarcloud.io/quality_gates/show/157178` (id `Spark Match Way`)
- GitHub repo: `https://github.com/spark-match/spark-match-03-backend`
- SonarCloud docs: https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/administering-your-projects/changing-binding.md
- AGENTS.md §13 B26 (config-file closed by PR #140; binding fix deferred)

## Handoff checklist (al retomar)

- [ ] Instalar SonarQube Cloud GH App en `spark-match` org.
- [ ] Re-bind SonarCloud project (o crear proyecto nuevo con key distinto).
- [ ] Verificar via MCP que `alm.url` = `spark-match/spark-match-03-backend`.
- [ ] Re-disparar PR #150 (close+reopen o empty commit).
- [ ] Confirmar `sonar / sonar-typescript-ci` en verde sin admin-bypass.
- [ ] Mergear PR #150.
- [ ] Archivar el proyecto SonarCloud `spark-match-03-backend` viejo (si re-binding).
- [ ] Cerrar este handoff en AGENTS.md §13 B26 (nueva línea: "binding fixed 2026-XX-XX by PR #XXX").
