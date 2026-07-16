import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount every rendered tree after each test, globally. Without this, a file
// that forgets its own afterEach(cleanup) leaves DOM behind and the next test
// sees duplicate elements ("found multiple elements") — an order-dependent
// flake rather than a real failure. Files may still call cleanup themselves;
// it is idempotent.
afterEach(cleanup);
