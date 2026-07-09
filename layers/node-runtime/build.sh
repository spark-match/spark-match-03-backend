#!/usr/bin/env bash
# Build script for spark-match-node-runtime layer
# Installs runtime dependencies and packages them as a Lambda Layer.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAYER_DIR="${SCRIPT_DIR}/nodejs"

echo "==> Building node-runtime layer"
echo "    Source: ${SCRIPT_DIR}/package.json"
echo "    Output: ${LAYER_DIR}"

rm -rf "${LAYER_DIR}"
mkdir -p "${LAYER_DIR}"

cd "${SCRIPT_DIR}"
echo "==> Installing production dependencies"
npm install --omit=dev --omit=peer --no-audit --no-fund --silent

echo "==> Copying node_modules to layer"
cp -r "${SCRIPT_DIR}/node_modules/." "${LAYER_DIR}/"

echo "==> node-runtime layer built successfully"
echo "    Path: ${LAYER_DIR}"
