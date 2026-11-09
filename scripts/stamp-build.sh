#!/bin/bash
# Run before committing app changes: bumps the build id the app uses to detect updates.
sed -i -E "s/const BUILD=\"[^\"]+\";/const BUILD=\"$(date -u +%Y%m%d%H%M)\";/" "$(dirname "$0")/../index.html"
