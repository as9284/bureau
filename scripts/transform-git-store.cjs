const fs = require('fs');
const path = require('path');
const file = path.join(process.env.DST, 'src/renderer/store/gitStore.ts');
let t = fs.readFileSync(file, 'utf8');

t = t.replace(/\brepoId\b/g, 'projectId');
t = t.replaceAll('StarGitError', 'BureauError');
t = t.replaceAll("from '@shared/contracts/repositories'", "from '@shared/contracts/gitSnapshot'");
t = t.replaceAll("from '@shared/contracts/operations'", "from '@shared/contracts/operations'");
t = t.replaceAll("window.starGit", "window.bureau");
t = t.replaceAll('starGit', 'bureau'); // careful
// undo over-replace of variable names if any - starGit only in window
t = t.replaceAll('window.bureau', 'window.bureau');

// Rename store export
t = t.replace('export const useAppStore', 'export const useGitStore');
t = t.replace(/type AppState/g, 'type GitStoreState');
t = t.replace(/AppState/g, 'GitStoreState');

// Fix error import
t = t.replace(
  /import type \{ BureauError \} from '@shared\/contracts\/operations'/,
  "import type { BureauError } from '@shared/contracts/errors'"
);
t = t.replace(
  /import type \{([\s\S]*?)BureauError([\s\S]*?)\} from '@shared\/contracts\/operations'/,
  (m, a, b) => {
    const inner = a + 'BureauError' + b;
    const parts = inner.split(',').map(s => s.trim()).filter(Boolean);
    const err = parts.filter(p => p === 'BureauError');
    const ops = parts.filter(p => p !== 'BureauError');
    let out = '';
    if (err.length) out += `import type { BureauError } from '@shared/contracts/errors';\n`;
    if (ops.length) out += `import type { ${ops.join(', ')} } from '@shared/contracts/operations';`;
    return out;
  }
);

// openInFileExplorer alias kept as method name for panels; implement via bureau.system.openInExplorer
t = t.replace(
  /api\(\)\.system\.openInFileExplorer/g,
  'api().system.openInExplorer'
);
// StarGit used repoId in system calls - already projectId
// Map openInFileExplorer store method to call openInExplorer IPC with projectId
t = t.replace(
  /openInFileExplorer:\s*async\s*\(projectId\)\s*=>\s*\{[\s\S]*?\},/,
  `openInFileExplorer: async (projectId) => {
    try {
      const result = await api().system.openInExplorer({ projectId });
      if (!result.ok) get().pushToast('error', result.error.message);
    } catch (err) {
      get().pushToast('error', toError(err, 'system.openInExplorer').message);
    }
  },`
);

// Fix clone/init imports if any
t = t.replace("from '@shared/contracts/lifecycle'", "from '@shared/contracts/gitLifecycle'");

// Compatibility: keep `repos` as snapshot holders - StarGit RepoState shape
// Ensure api helper
if (!t.includes('function api()')) {
  // StarGit uses getStarGit() or similar
}

fs.writeFileSync(file, t);
console.log('gitStore transformed, lines', t.split(/\n/).length);
// Show how api is obtained
const apiHits = [...t.matchAll(/function (get\w*|api)\(/g)].map(m => m[0]);
console.log('api helpers', apiHits.slice(0, 5));
const windowHits = [...t.matchAll(/window\.\w+/g)].map(m => m[0]);
console.log('window refs', [...new Set(windowHits)].slice(0, 10));
