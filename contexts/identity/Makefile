# =============================================================================
# SAM "makefile" build para IdentityMigrateFunction
# =============================================================================
# El resto de las funciones usa `BuildMethod: esbuild`, que SAM resuelve solo.
# migrate es la excepcion porque su artefacto necesita algo que el builder de
# esbuild no sabe empaquetar: los .sql de migrations/. El handler los busca en
# runtime con resolve(process.cwd(), 'migrations'), y process.cwd() dentro de
# Lambda es /var/task -- por eso se copian a la raiz del artefacto.
#
# El bundling NO se hace aca. `CustomMakeBuilder` corre `CopySource` (copia el
# CodeUri a un scratch dir) y despues `MakeBuild` con cwd en ese scratch: no
# hay `../../`, ni node_modules, ni tsconfig.base.json, asi que esbuild no
# resuelve `@spark-match/shared/*` ni `node-pg-migrate`. Invocar esbuild desde
# esta receta no podia funcionar en CI.
#
# En su lugar, `npm run bundle:migrate` (scripts/bundle-migrate.mjs) deja el
# artefacto listo en .build/migrate/ ANTES de `sam build`, corriendo desde la
# raiz del workspace donde todo resuelve. Esta receta solo lo copia: .build/
# vive dentro del CodeUri, asi que viaja en la copia al scratch dir.
#
# SAM invoca `make build-<LogicalId>` con ARTIFACTS_DIR apuntando al directorio
# de salida.
# =============================================================================

MIGRATE_BUILD_DIR := .build/migrate

build-IdentityMigrateFunction:
	@test -f "$(MIGRATE_BUILD_DIR)/migrate.mjs" || { \
		echo "ERROR: falta $(MIGRATE_BUILD_DIR)/migrate.mjs."; \
		echo "Corre 'npm run bundle:migrate' desde la raiz antes de 'sam build'."; \
		exit 1; \
	}
	cp -R "$(MIGRATE_BUILD_DIR)/." "$(ARTIFACTS_DIR)/"

.PHONY: build-IdentityMigrateFunction
