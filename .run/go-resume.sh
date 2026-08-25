#!/usr/bin/env bash
cd /d/repos/ai-story-builder || exit 1
npx tsx .run/resume.ts "${1:-6000}" > .run/resume.log 2>&1
grep -E "^RESUME|^  TODO|^PROGRESS|^DONE|^FAILED|^RESULT|^  " .run/resume.log | tail -30
