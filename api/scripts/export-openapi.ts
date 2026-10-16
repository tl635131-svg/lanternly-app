/** Writes the OpenAPI document to ./openapi.json (same as GET /docs/json). */
import { writeFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';

const app = await buildApp({ logger: false });
await app.ready();
writeFileSync('openapi.json', JSON.stringify(app.swagger(), null, 2));
console.log('Wrote openapi.json');
await app.close();
process.exit(0);
