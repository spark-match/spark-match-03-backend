<!-- markdownlint-disable MD041 -->
## Descripción

<!-- ¿Qué hace este PR? Sé breve pero claro. -->

## Tipo de cambio

- [ ] 🐛 Bug fix (cambio que arregla un issue)
- [ ] ✨ Nueva funcionalidad (cambio que agrega capacidad)
- [ ] ♻️ Refactor (cambio que no arregla bug ni agrega funcionalidad)
- [ ] 📚 Docs (cambios solo de documentación)
- [ ] 🧪 Tests (agregar o mejorar tests)
- [ ] 🔧 Config / CI / IaC

## Contexto(s) tocado(s)

- [ ] `shared/` (afecta a todos los contextos)
- [ ] `layers/` (afecta a todas las Lambdas)
- [ ] `contexts/identity/`
- [ ] `contexts/assessment/`
- [ ] `contexts/career/`
- [ ] `contexts/matching/`
- [ ] `events/`
- [ ] Raíz (template.yaml, package.json, tsconfig)
- [ ] `.github/` (workflows, CODEOWNERS)

## Checklist

- [ ] He corrido `npm run typecheck` localmente sin errores
- [ ] He corrido `npm run lint` localmente sin errores
- [ ] He corrido `npm test` localmente y los tests pasan
- [ ] He actualizado `docs/` si el cambio es arquitectónico
- [ ] He actualizado `docs/CHANGELOG.md` si aplica
- [ ] Si añadí una Lambda nueva, está en el `template.yaml` raíz como nested stack
- [ ] Si toqué schemas de eventos, actualicé `docs/EVENT_CATALOG.md`
- [ ] Si añadí un secreto nuevo, lo documenté en `docs/ARCHITECTURE.md` (sección 7)

## Impacto en costos

- [ ] No afecta costos
- [ ] Aumenta uso de Lambda (especificar # invocaciones esperadas/mes)
- [ ] Aumenta uso de Aurora / DynamoDB
- [ ] Aumenta uso de CloudWatch / X-Ray

## Screenshots / Diagramas (si aplica)

<!-- Adjuntar imágenes, Mermaid, etc. -->

## Referencias

<!-- Links a issues, ADRs, o docs relacionados -->
