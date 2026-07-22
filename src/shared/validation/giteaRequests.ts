import { z } from 'zod';
import { repoMutationRequestSchema } from './gitRequests';

// Header values and git refs must not carry control characters; a token pasted from a
// browser is the likeliest source of a stray CR/LF, which would allow header injection.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/;

/**
 * A Gitea instance URL supplied by the operator. Credentials in the URL are
 * rejected so the token never has a second home, and query/fragment are
 * rejected because the value is only ever used as an origin for API paths.
 */
export const giteaHostUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
      if (parsed.username || parsed.password) return false;
      if (parsed.search || parsed.hash) return false;
      return Boolean(parsed.hostname);
    } catch {
      return false;
    }
  }, 'Host must be an HTTP or HTTPS URL without credentials');

export const giteaConnectRequestSchema = z
  .object({
    hostUrl: giteaHostUrlSchema,
    token: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => value === value.trim(), 'Token must not have surrounding whitespace')
      .refine((value) => !CONTROL_CHARS_RE.test(value), 'Token contains control characters'),
  })
  .strict();

/**
 * Gitea owner names allow letters, digits, dash, underscore and dot, and may not
 * start or end with a separator. Repository names are the same set without the
 * boundary rule, but `.`/`..` would resolve to a path segment.
 */
export const giteaPublishRequestSchema = repoMutationRequestSchema
  .extend({
    branchName: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !value.startsWith('-'), 'branchName must not start with a dash')
      .refine((value) => !CONTROL_CHARS_RE.test(value), 'branchName contains control characters'),
    owner: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/, 'owner is not valid')
      .optional(),
    repositoryName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9._-]+$/, 'repositoryName contains unsupported characters')
      .refine((value) => value !== '.' && value !== '..', 'repositoryName is not valid'),
    visibility: z.enum(['public', 'private']),
    description: z.string().trim().max(350).optional(),
  })
  .strict();
