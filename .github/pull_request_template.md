<!-- markdownlint-disable MD041 -->
# Pull Request

## Resumen

<!-- Describa brevemente qué cambia este PR y por qué. -->

## Tipo de cambio

- [ ] Bugfix (cambio que arregla un issue, sin breaking change)
- [ ] Nueva feature (cambio que agrega funcionalidad, sin breaking change)
- [ ] Breaking change (fix o feature que haría que funcionalidad existente no funcione como antes)
- [ ] Refactor / housekeeping (sin cambio funcional)
- [ ] Documentación

## Alcance

- [ ] Cambios solo en `dev` (no afecta prod)
- [ ] Cambios que se aplicarán a `dev` y `prod` (requiere aprobación de CODE OWNERS + sync a main)

## Áreas tocadas

- [ ] `shared/` (afecta a todos los contextos)
- [ ] `layers/` (afecta a todas las Lambdas)
- [ ] `contexts/identity/` (único bounded context implementado)
- [ ] Raíz (`template.yaml`, `package.json`, `tsconfig`)
- [ ] `.github/` (workflows, CODEOWNERS)

## Items relacionados

<!-- Vincular a issues, ADRs u otros PRs cross-repo. -->

- Issue/ADR: #
- PR relacionado en otro repo `spark-match/`: #

## Checklist del autor

- [ ] `npm run typecheck` corre sin errores
- [ ] `npm run lint` corre sin errores
- [ ] `npm test` corre y los tests pasan
- [ ] `npm run test:coverage` cumple los umbrales 80/80/80/80
- [ ] Los commits siguen Conventional Commits (ver AGENTS.md §4.2)
- [ ] `git commit --no-verify` no se usó (los husky hooks corrieron)
- [ ] Si agregué una Lambda nueva, está en `template.yaml` raíz como nested stack
- [ ] Si toqué schemas de eventos, actualicé `docs/event-catalog.md`
- [ ] Si agregué un secreto nuevo, lo documenté en `docs/architecture.md` (sección 7)
- [ ] Si agregué un path nuevo al repo, lo liste en `.github/CODEOWNERS`
- [ ] Si agregué un scope nuevo a `.commitlintrc.json`, también actualicé AGENTS.md §4
- [ ] Documente cambios en `docs/` si el cambio es arquitectónico
- [ ] Actualicé `CHANGELOG.md` si la release-please lo requiere
- [ ] CI jobs del PR están todos en SUCCESS (SonarCloud omitido si hay bypass documentado)

## Checklist del reviewer

- [ ] El PR rama off `dev` (no de `main`)
- [ ] La descripción es clara y enlaza a issues/ADRs relevantes
- [ ] Los nuevos archivos tienen tests en el mismo PR (ver AGENTS.md §1 regla 5)
- [ ] No hay `code_smells` introducidos por el nuevo código (SonarCloud new_code_smells = 0)
- [ ] No hay secretos hardcodeados (AWS keys, passwords, etc.)
- [ ] No hay `any` introducido ni `@ts-ignore` / `@ts-expect-error` sin justificación
- [ ] Los tests cubren branches (no solo happy path)
- [ ] Los tags de SAM (`Project=spark-match`, `Environment=${Environment}`, `ManagedBy=SAM`, `Component=backend`) están presentes en recursos nuevos
- [ ] No se introdujeron dependencias nuevas sin PR de dependency-review separado

## Paths-ignored check

<!-- Si el PR toca exclusivamente archivos en `paths-ignore` de `.github/workflows/ci.yml`,
     los siguientes jobs NO corren y NO son bloqueantes:
     CodeQL (analiza JS/actions; no se ejecuta)
     actions que dependan de esos paths.
     Marcar lo que aplique:
     - [ ] Este PR solo toca archivos en paths-ignore y NO requiere re-correr el resto de CI
-->

## Screenshots / output relevante (si aplica)

<!-- Pegue el output relevante de `npm test`, `sam validate`, `npm run generate:openapi`, etc. -->

```text
$ sam validate -t template.yaml
... (pegar resumen)
```

## Notas para el deploy (si aplica)

<!-- Pasos manuales necesarios: bootstrap de recursos, crear GH secret, etc. -->
