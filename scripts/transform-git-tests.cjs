const fs = require('fs');
const path = require('path');
const DST = process.env.DST;
const files = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.includes(`${path.sep}git${path.sep}`) || p.includes('refChecks') || p.includes('graphLanes') || p.includes('parseUnifiedDiff') || p.includes('attention.test')) files.push(p);
  }
}
walk(path.join(DST, 'tests/unit'));
for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  t = t.replace(/\brepoId\b/g, 'projectId');
  t = t.replaceAll('StarGitError', 'BureauError');
  t = t.replaceAll("from '@shared/contracts/repositories'", "from '@shared/contracts/gitSnapshot'");
  t = t.replaceAll("from '@renderer/features/diff/parseUnifiedDiff'", "from '@renderer/features/git/diff/parseUnifiedDiff'");
  fs.writeFileSync(f, t);
}
console.log('Tests adapted', files.length);
