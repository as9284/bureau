const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const DST = process.env.DST;
const files = [
  ...walk(path.join(DST, 'src/renderer/features/git')),
  path.join(DST, 'src/renderer/lib/attention.ts'),
  path.join(DST, 'src/renderer/lib/gitContextMenuItems.ts'),
];

const importMap = [
  ["from '@renderer/features/sync/", "from '@renderer/features/git/sync/"],
  ["from '@renderer/features/changes/", "from '@renderer/features/git/changes/"],
  ["from '@renderer/features/diff/", "from '@renderer/features/git/diff/"],
  ["from '@renderer/features/commit/", "from '@renderer/features/git/commit/"],
  ["from '@renderer/features/branches/", "from '@renderer/features/git/branches/"],
  ["from '@renderer/features/stash/", "from '@renderer/features/git/stash/"],
  ["from '@renderer/features/history/", "from '@renderer/features/git/history/"],
  ["from '@renderer/features/worktrees/", "from '@renderer/features/git/worktrees/"],
  ["from '@renderer/features/submodules/", "from '@renderer/features/git/submodules/"],
  ["from '@renderer/features/tags/", "from '@renderer/features/git/tags/"],
  ["from '@renderer/features/recovery/", "from '@renderer/features/git/recovery/"],
  ["from '@renderer/features/lifecycle/", "from '@renderer/features/git/lifecycle/"],
  ["from '@renderer/features/github/", "from '@renderer/features/git/github/"],
  ["from '@renderer/lib/contextMenuItems'", "from '@renderer/lib/gitContextMenuItems'"],
  ["from './RepoWorkbench.css'", "from './GitWorkbench.css'"],
  ['export function RepoWorkbench', 'export function GitWorkbench'],
  ['function RepoWorkbench', 'function GitWorkbench'],
  ['StarGitMark', 'GitMark'],
  ['restart StarGit', 'restart Bureau'],
  ['removed from StarGit', 'removed from Bureau'],
];

let n = 0;
for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  const before = t;
  t = t.replace(/\brepoId\b/g, 'projectId');
  for (const [a, b] of importMap) t = t.split(a).join(b);
  // Fix relative parseUnifiedDiff if needed
   
  if (t !== before) {
    fs.writeFileSync(f, t);
    n++;
  }
}
console.log('Renderer transformed', n, '/', files.length);
