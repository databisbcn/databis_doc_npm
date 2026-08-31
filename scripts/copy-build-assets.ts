import { copyFileSync, mkdirSync } from 'node:fs';

const distributionDirectoryURL = new URL('../dist/', import.meta.url);
const sourceStyleURL = new URL('../src/style.css', import.meta.url);
const distributionStyleURL = new URL('style.css', distributionDirectoryURL);

mkdirSync(distributionDirectoryURL, { recursive: true });
copyFileSync(sourceStyleURL, distributionStyleURL);
