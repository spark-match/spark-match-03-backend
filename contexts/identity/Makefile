# =============================================================================
# SAM "makefile" build para IdentityMigrateFunction
# =============================================================================
# El resto de las funciones usa `BuildMethod: esbuild`, que SAM resuelve solo.
# migrate es la excepcion porque su artefacto necesita algo que el builder de
# esbuild no sabe empaquetar: los .sql de migrations/. El handler los busca en
# runtime con resolve(process.cwd(), 'migrations'), y process.cwd() dentro de
# Lambda es /var/task -- por eso se copian a la raiz del artefacto.
#
# SAM invoca `make build-<LogicalId>` con ARTIFACTS_DIR apuntando al directorio
# de salida, y toma como cwd el CodeUri de la funcion (contexts/identity/).
#
# El banner de createRequire hace falta porque el bundle sale en formato ESM y
# algunas dependencias CJS (node-pg-migrate, pg) llaman a `require` en runtime;
# sin el shim, el modulo revienta con "require is not defined".
# =============================================================================

build-IdentityMigrateFunction:
	npx --no-install esbuild src/handlers/migrate.ts \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=esm \
		--sourcemap \
		--external:pg-native \
		--banner:js="import{createRequire as __sparkRequire}from'node:module';const require=__sparkRequire(import.meta.url);" \
		--outfile="$(ARTIFACTS_DIR)/migrate.mjs"
	cp -R ../../migrations "$(ARTIFACTS_DIR)/migrations"

.PHONY: build-IdentityMigrateFunction
