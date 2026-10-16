/**
 * Regenerates the schema-derived parts of ../api-contract.md from the zod schemas and the OpenAPI document,
 * and writes openapi.json. Sections between `<!-- GENERATED:<name>:start -->` and `<!-- GENERATED:<name>:end -->` are replaced.
 *   npm run contract
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { ContentSectionSchemas, CustomContentSchema, HeroSchema, InvitationConfigSchema } from '../src/lib/theme-engine.js';
import { BriefSectionSchemas, CustomBlockSchema, RsvpSettingsSchema } from '../src/lib/brief.js';
import { EXTRA_BRIEF_SECTIONS } from '../src/lib/catalogue.js';
import { RsvpInput } from '../src/services/guests.js';

type J = Record<string, any>;

/** Render a JSON schema as a compact TypeScript-like type. `?` = optional. */
export function render(s: J | undefined, depth = 0): string {
  if (!s || typeof s !== 'object') return 'unknown';
  if (s.anyOf || s.oneOf) {
    const parts = (s.anyOf ?? s.oneOf).map((x: J) => render(x, depth));
    return [...new Set(parts)].join(' | ');
  }
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((e: unknown) => JSON.stringify(e)).join(' | ');
  const t = Array.isArray(s.type) ? s.type : [s.type];
  if (t.includes('null') && t.length > 1) return `${render({ ...s, type: t.filter((x: string) => x !== 'null')[0] }, depth)} | null`;
  switch (t[0]) {
    case 'string': {
      const notes: string[] = [];
      if (s.format === 'uuid') return 'uuid';
      if (s.format === 'email') return `email${s.maxLength ? `(≤${s.maxLength})` : ''}`;
      if (s.format === 'date-time') return 'ISO datetime';
      if (s.pattern === '^#[0-9a-fA-F]{6}$') return '"#RRGGBB"';
      if (s.pattern === '^\\d{4}-\\d{2}-\\d{2}$') return '"YYYY-MM-DD"';
      if (s.pattern) notes.push(`/${s.pattern}/`);
      if (s.minLength) notes.push(`min ${s.minLength}`);
      if (s.maxLength) notes.push(`≤${s.maxLength}`);
      return notes.length ? `string(${notes.join(', ')})` : 'string';
    }
    case 'integer':
    case 'number': {
      const r = [s.minimum, s.maximum].some((x) => x !== undefined) ? `(${s.minimum ?? ''}…${s.maximum ?? ''})` : '';
      return `${t[0] === 'integer' ? 'int' : 'number'}${r}`;
    }
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return `${wrap(render(s.items, depth))}[]${s.maxItems ? ` (≤${s.maxItems})` : ''}`;
    case 'object': {
      const props = s.properties ?? {};
      const req = new Set<string>(s.required ?? []);
      const keys = Object.keys(props);
      if (!keys.length) return s.additionalProperties && s.additionalProperties !== true && s.additionalProperties !== false ? `Record<string, ${render(s.additionalProperties, depth)}>` : 'object';
      return `{ ${keys.map((k) => `${k}${req.has(k) ? '' : '?'}: ${render(props[k], depth + 1)}`).join('; ')} }`;
    }
    default:
      return 'unknown';
  }
}
const wrap = (x: string) => (x.includes(' | ') ? `(${x})` : x);
const js = (schema: z.ZodTypeAny) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as J;
const code = (x: string) => '`' + x.replace(/\|/g, '\\|') + '`';

function sectionsTable() {
  const extraKeys = new Set(Object.values(EXTRA_BRIEF_SECTIONS));
  const lines = ['| key | invitation `content[lang].sections[key]` shape |', '|---|---|'];
  for (const [key, schema] of Object.entries(ContentSectionSchemas)) lines.push(`| \`${key}\` | ${code(render(js(schema)))} |`);
  lines.push(`| \`custom:<slug>\` | ${code(render(js(CustomContentSchema)))} |`);
  lines.push('');
  lines.push('`hero`: ' + code(render(js(HeroSchema))) + ' · `footer`: `{ signature?: string(≤200) }`');
  lines.push('');
  lines.push('**Brief data** (`PATCH /api/events/:id/brief` → `data[key]`) uses the same shapes without `heading`, plus the extra-only sections:');
  lines.push('');
  lines.push('| brief key | shape |', '|---|---|');
  for (const [key, schema] of Object.entries(BriefSectionSchemas)) {
    if (key === 'rsvp') continue;
    if (!extraKeys.has(key) && ContentSectionSchemas[key]) continue;
    lines.push(`| \`${key}\` | ${code(render(js(schema)))} |`);
  }
  lines.push(`| \`custom:<slug>\` | ${code(render(js(CustomBlockSchema)))} |`);
  lines.push(`| \`rsvp\` | RsvpSettings (below) |`);
  return lines.join('\n');
}

function settingsBlock() {
  return [
    '**RsvpSettings** (all fields optional on PATCH): ' + code(render(js(RsvpSettingsSchema))),
    '',
    '**Invitation `config`** (strict — unknown keys rejected): ' + code(render(js(InvitationConfigSchema))),
    '',
    '**Public RSVP body** (`POST /api/public/invitations/:slug/rsvps`): ' + code(render(js(RsvpInput))),
  ].join('\n');
}

function endpointsTable(doc: J) {
  const lines = ['| Method | Path | Query | Body (JSON) | Summary |', '|---|---|---|---|---|'];
  for (const [path, methods] of Object.entries<J>(doc.paths)) {
    if (path.startsWith('/docs')) continue;
    for (const [m, op] of Object.entries<J>(methods)) {
      if (m === 'head') continue;
      const q = (op.parameters ?? []).filter((p: J) => p.in === 'query').map((p: J) => `${p.name}${p.required ? '' : '?'}: ${render(p.schema)}`);
      const body = op.requestBody?.content?.['application/json']?.schema;
      lines.push(`| ${m.toUpperCase()} | \`${path.replace(/{(\w+)}/g, ':$1')}\` | ${q.length ? code(q.join('; ')) : ''} | ${body ? code(render(body)) : ''} | ${(op.summary ?? '').replace(/\|/g, '\\|')} |`);
    }
  }
  return lines.join('\n');
}

function replaceBlock(md: string, name: string, content: string) {
  const start = `<!-- GENERATED:${name}:start -->`;
  const end = `<!-- GENERATED:${name}:end -->`;
  const i = md.indexOf(start);
  const j = md.indexOf(end);
  if (i < 0 || j < 0) throw new Error(`Missing markers for ${name} in api-contract.md`);
  return md.slice(0, i + start.length) + '\n' + content + '\n' + md.slice(j);
}

const check = process.argv.includes('--check');
const app = await buildApp({ logger: false });
await app.ready();
const doc = app.swagger() as J;
const openapi = JSON.stringify(doc, null, 2) + '\n';
const path = '../api-contract.md';
const current = readFileSync(path, 'utf8');
let md = current;
md = replaceBlock(md, 'sections', sectionsTable());
md = replaceBlock(md, 'settings', settingsBlock());
md = replaceBlock(md, 'endpoints', endpointsTable(doc));
await app.close();
if (check) {
  const stale: string[] = [];
  if (md !== current) stale.push('api-contract.md');
  let oldOpenapi = '';
  try {
    oldOpenapi = readFileSync('openapi.json', 'utf8');
  } catch {}
  if (oldOpenapi !== openapi) stale.push('openapi.json');
  if (stale.length) {
    console.error(`Out of date: ${stale.join(', ')}. Run \`npm run contract\`.`);
    process.exit(1);
  }
  console.log('api-contract.md generated blocks and openapi.json are up to date');
  process.exit(0);
}
writeFileSync('openapi.json', openapi);
writeFileSync(path, md);
console.log('Updated api-contract.md generated blocks and openapi.json');
process.exit(0);
