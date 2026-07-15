/** Maximum page size enforced in main-process queries. */
export const MAX_PAGE_SIZE = 100;

export const DEFAULT_PAGE_SIZE = 50;

export type PageResult<T> = {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
};

export type PageRequest = {
  cursor?: string;
  limit?: number;
};
