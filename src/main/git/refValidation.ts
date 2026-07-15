import type { GitRunner } from './GitRunner';
import { checkOidFormat, checkRefNameBasics, type RefFormatError } from '@shared/git/refChecks';
import { toBureauError } from '../ipc/errors';

const REF_CHECK_TIMEOUT_MS = 10_000;

export type RefValidationService = {
  validateRefName(
    executablePath: string,
    repoPath: string,
    refName: string
  ): Promise<RefFormatError | undefined>;
  resolveOid(
    executablePath: string,
    repoPath: string,
    oid: string
  ): Promise<string | RefFormatError>;
  validateRemoteName(name: string, allowedRemotes: string[]): RefFormatError | undefined;
};

export function createRefValidationService(runner: GitRunner): RefValidationService {
  async function validateRefName(
    executablePath: string,
    repoPath: string,
    refName: string
  ): Promise<RefFormatError | undefined> {
    const basic = checkRefNameBasics(refName);
    if (basic) return basic;

    const result = await runner.run(executablePath, {
      args: ['-C', repoPath, 'check-ref-format', '--branch', refName],
      timeoutMs: REF_CHECK_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      return {
        code: 'INVALID_REF',
        message: result.stderr.trim() || 'Invalid ref name.',
      };
    }
    return undefined;
  }

  async function resolveOid(
    executablePath: string,
    repoPath: string,
    oid: string
  ): Promise<string | RefFormatError> {
    const formatError = checkOidFormat(oid);
    if (formatError) return formatError;

    const result = await runner.run(executablePath, {
      args: ['-C', repoPath, 'rev-parse', '--verify', `${oid}^{commit}`],
      timeoutMs: REF_CHECK_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      return { code: 'INVALID_REF', message: 'OID does not resolve to a commit.' };
    }
    return result.stdout.trim();
  }

  function validateRemoteName(name: string, allowedRemotes: string[]): RefFormatError | undefined {
    const basic = checkRefNameBasics(name);
    if (basic) return basic;
    if (!allowedRemotes.includes(name)) {
      return { code: 'INVALID_REF', message: `Remote "${name}" is not configured.` };
    }
    return undefined;
  }

  return { validateRefName, resolveOid, validateRemoteName };
}

export function refErrorToBureau(
  error: RefFormatError,
  operation: string,
  projectId?: string
): ReturnType<typeof toBureauError> {
  return toBureauError({
    code: 'INVALID_REQUEST',
    message: error.message,
    operation,
    subjectId: projectId,
    retryable: false,
  });
}
