import { initializePlatform } from './index.js';

try {
  await initializePlatform();
} catch (error) {
  console.error('Platform initialization failed; continuing with browser storage.', error);
}

await import('../main.js');
