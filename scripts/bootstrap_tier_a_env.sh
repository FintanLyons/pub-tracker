#!/usr/bin/env bash
# Create .venv for Tier A fetch script when "python3 -m venv" fails (missing ensurepip).
#
# Option B (no sudo): install uv, then re-run this script:
#   curl -LsSf https://astral.sh/uv/install.sh | sh
#   export PATH="$HOME/.local/bin:$PATH"
#
# Option A (one-time sudo): sudo apt install python3.12-venv
#   then: python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements_tier_a.txt

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
REQ="scripts/requirements_tier_a.txt"

rm -rf .venv

if python3 -m venv .venv 2>/dev/null && test -x .venv/bin/pip; then
  echo "Created .venv with: python3 -m venv"
elif command -v uv >/dev/null 2>&1; then
  uv venv .venv
  echo "Created .venv with: uv venv (bundled pip; no system ensurepip needed)"
else
  echo "Could not create a venv."
  echo ""
  echo "  With sudo (Debian/Ubuntu):  sudo apt install python3.12-venv"
  echo "  Then:                      python3 -m venv .venv"
  echo ""
  echo "  Without sudo: install uv, then re-run this script:"
  echo "    curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo "    scripts/bootstrap_tier_a_env.sh"
  exit 1
fi

.venv/bin/pip install -r "$REQ"
echo ""
echo "Ready. Example:"
echo "  .venv/bin/python scripts/fetch_pub_websites_tier_a.py --sample 100 --seed 42"
