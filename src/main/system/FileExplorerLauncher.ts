import { shell } from 'electron';

export function openInFileExplorer(repositoryRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const result = shell.openPath(repositoryRoot);
    result
      .then((errorMessage) => {
        if (errorMessage && errorMessage.length > 0) {
          reject(new Error(errorMessage));
        } else {
          resolve();
        }
      })
      .catch(reject);
  });
}
