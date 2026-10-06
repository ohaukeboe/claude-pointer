#!/bin/sh
# Quality gates (constitution: Development Workflow & Quality Gates). Stops on first failure.
set -eu
cd "$(dirname "$0")/.."
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run lint:ext
echo "All quality gates passed."
