import type {
  BranchState,
  ChangedFile,
  LatestCommit,
  UpstreamState,
} from '@shared/contracts/gitSnapshot';

export type PorcelainV2Status = {
  branch: BranchState;
  upstream: UpstreamState;
  changedFiles: ChangedFile[];
};

export function parsePorcelainV2Status(output: string): PorcelainV2Status {
  const records = splitNulRecords(output);
  let branch: BranchState = { kind: 'unborn' };
  let isUnborn = false;
  let upstream: UpstreamState = { kind: 'none' };
  const changedFiles: ChangedFile[] = [];

  let i = 0;
  while (i < records.length) {
    const record = records[i];
    if (record.startsWith('# ')) {
      const parsed = parseHeaderLine(record);
      if (parsed.isUnborn) isUnborn = true;
      if (parsed.branch) branch = mergeBranchState(branch, parsed.branch);
      if (parsed.upstream) upstream = mergeUpstreamState(upstream, parsed.upstream);
      i += 1;
      continue;
    }

    if (record.startsWith('1 ') || record.startsWith('? ') || record.startsWith('u ')) {
      const file = parseSingleRecord(record);
      if (file) changedFiles.push(file);
      i += 1;
      continue;
    }

    if (record.startsWith('2 ')) {
      // Rename/copy records span two NUL-terminated fields: metadata and original path.
      const originalPath = records[i + 1];
      const file = parseRenameRecord(record, originalPath);
      if (file) changedFiles.push(file);
      i += 2;
      continue;
    }

    // Ignore unknown records.
    i += 1;
  }

  if (isUnborn) {
    branch = { kind: 'unborn' };
  }

  return { branch, upstream, changedFiles };
}

function splitNulRecords(output: string): string[] {
  return output.split('\0').filter((r) => r.length > 0);
}

function parseHeaderLine(line: string): {
  branch?: BranchState;
  upstream?: UpstreamState;
  isUnborn?: boolean;
} {
  const result: { branch?: BranchState; upstream?: UpstreamState; isUnborn?: boolean } = {};
  const content = line.slice(2);

  if (content.startsWith('branch.oid ')) {
    const oid = content.slice('branch.oid '.length);
    if (oid !== '(initial)') {
      // We cannot determine named/detached from oid alone; head is set separately.
      result.branch = { kind: 'named', name: '', headOid: oid };
    } else {
      result.isUnborn = true;
    }
  } else if (content.startsWith('branch.head ')) {
    const head = content.slice('branch.head '.length);
    if (head === '(detached)') {
      result.branch = { kind: 'detached', headOid: '' };
    } else {
      result.branch = { kind: 'named', name: head };
    }
  } else if (content.startsWith('branch.upstream ')) {
    const ref = content.slice('branch.upstream '.length);
    result.upstream = { kind: 'tracking', ref, ahead: 0, behind: 0, basis: 'localTrackingRef' };
  } else if (content.startsWith('branch.ab ')) {
    const ab = content.slice('branch.ab '.length);
    const aheadMatch = ab.match(/\+(-?\d+)/);
    const behindMatch = ab.match(/-(-?\d+)/);
    const ahead = aheadMatch ? parseInt(aheadMatch[1], 10) : 0;
    const behind = behindMatch ? parseInt(behindMatch[1], 10) : 0;
    result.upstream = { kind: 'tracking', ahead, behind, basis: 'localTrackingRef' };
  }

  return result;
}

function mergeBranchState(a: BranchState, b: BranchState): BranchState {
  if (a.kind === 'named' && b.kind === 'named') {
    return { kind: 'named', name: b.name || a.name, headOid: b.headOid ?? a.headOid };
  }
  if (b.kind === 'detached') {
    const headOid = b.headOid || (a.kind !== 'unborn' ? a.headOid : undefined) || '';
    return { kind: 'detached', headOid };
  }
  if (b.kind === 'unborn') return a;
  return b;
}

function mergeUpstreamState(a: UpstreamState, b: UpstreamState): UpstreamState {
  if (a.kind !== 'tracking' || b.kind !== 'tracking') return b;
  return { ...a, ...b };
}

function parseSingleRecord(record: string): ChangedFile | undefined {
  const type = record[0];
  const fields = record.slice(2).split(' ');

  if (type === '?') {
    const path = fields.join(' ');
    return {
      path,
      indexCode: '?',
      worktreeCode: '?',
      kind: 'untracked',
      staged: false,
      unstaged: false,
      untracked: true,
      unmerged: false,
    };
  }

  if (type === 'u') {
    // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path> — path is field 9 (after slice(2)),
    // joined so paths containing spaces survive.
    const path = fields.slice(9).join(' ');
    if (!path) return undefined;
    return {
      path,
      indexCode: 'U',
      worktreeCode: 'U',
      kind: 'unmerged',
      staged: false,
      unstaged: false,
      untracked: false,
      unmerged: true,
    };
  }

  if (type === '1') {
    const xy = fields[0] ?? '';
    const path = fields.slice(7).join(' ');
    return makeChangedFile(path, xy);
  }

  return undefined;
}

function parseRenameRecord(
  record: string,
  originalPath: string | undefined
): ChangedFile | undefined {
  const fields = record.slice(2).split(' ');
  const xy = fields[0] ?? '';
  // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path> — the destination path is field 8
  // (origPath is split off separately and passed in). Join to keep paths that contain spaces.
  const path = fields.slice(8).join(' ');
  return makeChangedFile(path, xy, originalPath);
}

function makeChangedFile(path: string, xy: string, originalPath?: string): ChangedFile {
  const indexCode = xy[0] ?? ' ';
  const worktreeCode = xy[1] ?? ' ';
  const staged = indexCode !== ' ' && indexCode !== '.' && indexCode !== '?';
  const unstaged = worktreeCode !== ' ' && worktreeCode !== '.' && worktreeCode !== '?';
  const untracked = indexCode === '?' || worktreeCode === '?';
  const unmerged = indexCode === 'U' || worktreeCode === 'U';
  const kind: ChangedFile['kind'] = originalPath ? 'renameOrCopy' : 'ordinary';

  return {
    path,
    originalPath,
    indexCode,
    worktreeCode,
    kind,
    staged,
    unstaged,
    untracked,
    unmerged,
  };
}

export function parseLatestCommit(output: string): LatestCommit | undefined {
  const parts = output.split('\0');
  if (parts.length < 5) return undefined;
  const [oid, abbreviatedOid, authorName, committedAt, subject] = parts;
  if (!oid || !abbreviatedOid) return undefined;
  return {
    oid,
    abbreviatedOid,
    authorName: authorName ?? '',
    committedAt: committedAt ?? '',
    subject: (subject ?? '').trimEnd(),
  };
}
