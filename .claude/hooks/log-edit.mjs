#!/usr/bin/env node
// PostToolUse hook: logs edits of structural files to .claude/.project-map-pending.log
// Filters for src/, prisma/, and key top-level config files.
// Fails silently — must never block tool execution.

import fs from 'node:fs';
import path from 'node:path';

const LOG = '.claude/.project-map-pending.log';

const STRUCTURAL = /(?:[\\/])(?:src|prisma)[\\/]|(?:^|[\\/])(?:package\.json|next\.config\.(?:ts|js|mjs)|\.env\.example|prisma\.config\.ts)$/;

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (buf += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(buf);
    const ti = input.tool_input || {};
    // Edit/Write use file_path; NotebookEdit uses notebook_path; MultiEdit may use edits[].file_path too
    const paths = [];
    if (ti.file_path) paths.push(ti.file_path);
    if (ti.notebook_path) paths.push(ti.notebook_path);
    if (Array.isArray(ti.edits)) for (const e of ti.edits) if (e.file_path) paths.push(e.file_path);

    const lines = [];
    for (const p of paths) {
      if (typeof p === 'string' && STRUCTURAL.test(p.replace(/\\/g, '/'))) {
        lines.push(p);
      }
    }
    if (lines.length) {
      fs.mkdirSync(path.dirname(LOG), { recursive: true });
      fs.appendFileSync(LOG, lines.join('\n') + '\n');
    }
  } catch {
    // swallow — hook must never block
  }
});
