import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Komponenten-Tree zwischen Tests aufräumen, damit Komponenten sich nicht
// gegenseitig beeinflussen (Side-Effects in useEffect / Portals).
afterEach(() => {
  cleanup();
});
