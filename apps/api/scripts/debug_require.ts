
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mod = require('pdf-parse');
console.log('Mod:', mod);
