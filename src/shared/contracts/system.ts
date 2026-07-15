export type ChooseDirectoryRequest = {
  title?: string;
  buttonLabel?: string;
};

export type ChooseDirectoryResult = {
  path: string | null;
  /** Present when the user dismissed the picker (path is null). */
  cancelled?: boolean;
};
