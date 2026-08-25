#!/usr/bin/env bash
cd /d/repos/ai-story-builder || exit 1
npx tsx .run/run-template.ts "${1:-3}" > .run/run.log 2>&1
grep -E "^START|^PROGRESS|^DONE|^FAILED|^RESULT" .run/run.log | tail -40
