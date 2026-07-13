#!/usr/bin/env bash
# Build script for spark-match-node-shared layer
# Compiles shared/ to dist/ and packages it as a Lambda Layer.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SHARED_SRC="${BACKEND_ROOT}/shared/src"
LAYER_DIR="${SCRIPT_DIR}/dist"

echo "==> Building node-shared layer"
echo "    Source: ${SHARED_SRC}"
echo "    Output: ${LAYER_DIR}"

rm -rf "${LAYER_DIR}"
mkdir -p "${LAYER_DIR}/nodejs/node_modules/@spark-match/shared"
mkdir -p "${LAYER_DIR}/nodejs/node_modules/@spark-match/shared/node_modules"

# Compile TypeScript
echo "==> Compiling TypeScript"
cd "${BACKEND_ROOT}/shared"
npx tsc

# Copy compiled JS + types to layer
echo "==> Copying compiled output to layer"
cp -r "${BACKEND_ROOT}/shared/dist/"* "${LAYER_DIR}/nodejs/node_modules/@spark-match/shared/"

# Make node_modules available for runtime deps bundled in shared
cp -r "${BACKEND_ROOT}/shared/node_modules/." "${LAYER_DIR}/nodejs/node_modules/@spark-match/shared/node_modules/" 2>/dev/null || true

# Create a package.json for the layer so Node knows the main entry
cat > "${LAYER_DIR}/nodejs/node_modules/@spark-match/shared/package.json" <<'EOF'
{
  "name": "@spark-match/shared",
  "version": "0.1.0",
  "main": "index.js",
  "types": "index.d.ts"
}
EOF

echo "==> node-shared layer built successfully"
echo "    Path: ${LAYER_DIR}/nodejs"
