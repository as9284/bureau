import type { BureauApiV1 } from '@shared/contracts/api';

declare global {
  interface Window {
    readonly bureau: BureauApiV1;
  }
}

export {};
