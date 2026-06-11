#!/usr/bin/env bash
# Horrorgeticon Ops starten (Linux/macOS). Demo-Daten beim ersten Start: --demo
cd "$(dirname "$0")/.." || exit 1
exec node server/main.js "$@"
