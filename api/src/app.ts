import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { hasZodFastifySchemaValidationErrors, jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { config } from './config.js';
import { registerAuth } from './lib/auth.js';
import { AppError } from './lib/errors.js';
import { registerRoutes } from './routes/index.js';

export interface BuildOptions {
  logger?: boolean;
  rateLimits?: Partial<{ authPerMinute: number; rsvpPerMinute: number; rsvpPerHour: number; enabled: boolean; multiplier: number }>;
}

export type App = FastifyInstance;

function fieldsFromZodIssues(issues: { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const i of issues) fields[i.path.map(String).join('.') || '_'] ??= i.message;
  return fields;
}

export async function buildApp(opts: BuildOptions = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.LOG_LEVEL, redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf"]'] },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const limits = {
    enabled: opts.rateLimits?.enabled ?? config.RATE_LIMIT_ENABLED,
    authPerMinute: opts.rateLimits?.authPerMinute ?? config.RATE_LIMIT_AUTH_PER_MIN,
    rsvpPerMinute: opts.rateLimits?.rsvpPerMinute ?? config.RATE_LIMIT_RSVP_PER_MIN,
    rsvpPerHour: opts.rateLimits?.rsvpPerHour ?? config.RATE_LIMIT_RSVP_PER_HOUR,
    multiplier: opts.rateLimits?.multiplier ?? config.RATE_LIMIT_MULTIPLIER,
  };
  app.decorate('limits', limits);

  // Security headers. This is a JSON API, so the default CSP allows nothing and forbids framing.
  // /docs (Swagger UI) gets its own CSP below. HSTS only in production (served over HTTPS behind a proxy).
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'self'"] } },
    hsts: config.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    // Signed asset / music URLs are embedded by the web app on another origin (<img>, <audio>); access is controlled by the signature.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
  });
  const DOCS_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  app.addHook('onSend', async (req, reply) => {
    if (req.url === '/docs' || req.url.startsWith('/docs/')) reply.header('content-security-policy', DOCS_CSP);
    reply.removeHeader('x-powered-by');
    reply.removeHeader('server');
  });

  // CORS: only the configured web origin(s) (exact match, validated in config), with credentials.
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    allowedHeaders: ['content-type', 'x-csrf', 'idempotency-key'],
    exposedHeaders: ['content-disposition'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
  await app.register(cookie, { secret: config.APP_SECRET });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 10 } });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, code: 'RATE_LIMITED', message: `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)}s.` }),
  });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Invitation Platform API', version: '0.1.0', description: 'Back end for the digital invitation platform. See app/api-contract.md for the human-readable contract.' },
      servers: [{ url: config.API_PUBLIC_URL }],
      components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'sid' }, csrf: { type: 'apiKey', in: 'header', name: 'x-csrf' } } },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  registerAuth(app);

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}), ...(err.details ? { details: err.details } : {}) } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const fields: Record<string, string> = {};
      for (const v of err.validation) {
        const path = [err.validationContext === 'body' ? '' : err.validationContext, ...v.instancePath.split('/').filter(Boolean)].filter(Boolean).join('.');
        fields[path || '_'] ??= v.message ?? 'Invalid value';
      }
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid.', fields } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid.', fields: fieldsFromZodIssues(err.issues) } });
    }
    if (err?.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: err.message ?? 'Too many requests.' } });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return reply.code(409).send({ error: { code: 'CONFLICT', message: 'A record with these details already exists.' } });
      if (err.code === 'P2025') return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
    }
    if (err?.code === 'FST_REQ_FILE_TOO_LARGE' || err?.statusCode === 413) {
      return reply.code(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The upload is too large.' } });
    }
    if (err?.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err?.statusCode === 415) {
      return reply.code(415).send({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content type.' } });
    }
    if (typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url.split('?')[0]} not found.` } }));

  await registerRoutes(app);
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    limits: { enabled: boolean; authPerMinute: number; rsvpPerMinute: number; rsvpPerHour: number; multiplier: number };
  }
}
