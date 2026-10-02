#!/usr/bin/env bash
# Build a pip-installable sdist and publish it under packaging/download/
# for the Nest/nginx download endpoint used by install.sh.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT}/packaging/download"
DIST_DIR="${ROOT}/dist"

mkdir -p "${OUT_DIR}" "${DIST_DIR}"
cd "${ROOT}"

python3 -m pip install --quiet --upgrade build >/dev/null
python3 -m build --sdist --outdir "${DIST_DIR}"

SDIST="$(ls -1t "${DIST_DIR}"/vpsguard_agent-*.tar.gz "${DIST_DIR}"/vpsguard-agent-*.tar.gz 2>/dev/null | head -n1 || true)"
if [ -z "${SDIST}" ]; then
  echo "No sdist produced in ${DIST_DIR}" >&2
  exit 1
fi

cp -f "${SDIST}" "${OUT_DIR}/vpsguard-agent.tar.gz"
echo "Wrote ${OUT_DIR}/vpsguard-agent.tar.gz ($(wc -c < "${OUT_DIR}/vpsguard-agent.tar.gz") bytes)"
