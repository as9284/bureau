const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const roots = [
  path.join(process.env.DST, 'src/main/git'),
  path.join(process.env.DST, 'src/main/github'),
];
const singles = [
  path.join(process.env.DST, 'src/main/operations/OperationCoordinator.ts'),
  path.join(process.env.DST, 'src/main/operations/OperationRegistry.ts'),
  path.join(process.env.DST, 'src/main/projects/SnapshotCache.ts'),
];

const files = [...singles, ...roots.flatMap((r) => walk(r))];

function transform(src) {
  let t = src;

  t = t.replaceAll('toStarGitError', 'toBureauError');
  t = t.replaceAll('isStarGitError', 'isBureauError');
  t = t.replaceAll('StarGitErrorCode', 'BureauErrorCode');
  t = t.replaceAll('StarGitError', 'BureauError');
  t = t.replaceAll("from '../repositories/RepositoryCatalogue'", "from '../projects/ProjectCatalogue'");
  t = t.replaceAll("from '../repositories/SnapshotCache'", "from '../projects/SnapshotCache'");
  t = t.replaceAll('RepositoryCatalogue', 'ProjectCatalogue');
  t = t.replaceAll("from '@shared/contracts/repositories'", "from '@shared/contracts/gitSnapshot'");
  t = t.replaceAll('REPOSITORY_NOT_FOUND', 'PROJECT_NOT_FOUND');
  t = t.replaceAll('REPOSITORY_UNAVAILABLE', 'PROJECT_NOT_FOUND');
  t = t.replaceAll('refErrorToStarGit', 'refErrorToBureau');
  t = t.replaceAll('runRepoRead', 'runProjectRead');

  // Word-boundary repoId → projectId
  t = t.replace(/\brepoId\b/g, 'projectId');

  // Split imports that mix BureauError* with operation request types
  t = t.replace(
    /import type \{([^}]+)\} from '@shared\/contracts\/operations';/g,
    (full, inner) => {
      const parts = inner.split(',').map((s) => s.trim()).filter(Boolean);
      const err = parts.filter((p) => p === 'BureauError' || p === 'BureauErrorCode');
      const ops = parts.filter((p) => p !== 'BureauError' && p !== 'BureauErrorCode');
      const lines = [];
      if (err.length) lines.push(`import type { ${err.join(', ')} } from '@shared/contracts/errors';`);
      if (ops.length) lines.push(`import type { ${ops.join(', ')} } from '@shared/contracts/operations';`);
      return lines.join('\n');
    }
  );

  // In toBureauError / throw objects: convert property key projectId → subjectId
  // Only when the value is an expression (not `string` type annotation in object types — those use `projectId: string`)
  // Handle multiline object literals for toBureauError({ ... })
  t = t.replace(/toBureauError\(\{([\s\S]*?)\}\)/g, (full, body) => {
    const fixed = body
      .replace(/(^|\n)(\s*)projectId,/g, '$1$2subjectId: projectId,')
      .replace(/(^|\n)(\s*)projectId:\s*(?!string\b)/g, '$1$2subjectId: ');
    return `toBureauError({${fixed}})`;
  });

  return t;
}

let n = 0;
for (const f of files) {
  const before = fs.readFileSync(f, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(f, after);
    n++;
  }
}
console.log(`Transformed ${n}/${files.length} files`);
console.log('GitMutationService lines', fs.readFileSync(path.join(process.env.DST, 'src/main/git/GitMutationService.ts'), 'utf8').split(/\n/).length);
