#!/usr/bin/env node
// SessionStart hook: if there are pending structural edits, tell Claude to
// update PROJECT_MAP.md via the project-map-keeper agent before doing other work.

import fs from 'node:fs';

const LOG = '.claude/.project-map-pending.log';

try {
  if (!fs.existsSync(LOG)) process.exit(0);
  const raw = fs.readFileSync(LOG, 'utf8').trim();
  if (!raw) process.exit(0);

  const files = [...new Set(raw.split('\n').filter(Boolean))];
  const preview = files.slice(0, 15).join('\n');
  const more = files.length > 15 ? `\n…and ${files.length - 15} more` : '';

  const ctx =
    `PROJECT_MAP.md may be stale. ${files.length} structural file(s) have been edited since the last map refresh:\n` +
    preview + more + '\n\n' +
    'Before handling the user\'s request, invoke the `project-map-keeper` agent (Task tool with subagent_type="project-map-keeper") to update PROJECT_MAP.md. The agent will decide whether each pending change is structural and surgically edit the map, then clear the pending log.';

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: ctx,
    },
  }));
} catch {
  // swallow
}
