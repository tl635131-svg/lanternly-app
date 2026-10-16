export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'INVALID_EMAIL'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'CSRF_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'GONE'
  | 'CONFLICT'
  | 'VERSION_CONFLICT'
  | 'ALREADY_RESPONDED'
  | 'BRIEF_LOCKED'
  | 'BRIEF_INCOMPLETE'
  | 'REVISION_NOT_ALLOWED'
  | 'INVALID_SELECTION'
  | 'INVALID_TOKEN'
  | 'PAYMENT_REQUIRED'
  | 'ADDON_PAYMENT_REQUIRED'
  | 'PLAN_NOT_PAID'
  | 'FEATURE_DISABLED'
  | 'GIFT_PAYOUT_REQUIRED'
  | 'GIFT_REGISTRY_URL_REQUIRED'
  | 'RIGHTS_CONFIRMATION_REQUIRED'
  | 'RSVP_CLOSED'
  | 'CHANNEL_NOT_AVAILABLE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'TOO_MANY_ATTEMPTS'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'BAD_REQUEST', message, fields);
export const validation = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'VALIDATION_ERROR', message, fields);
export const unauthenticated = (message = 'Please sign in to continue.') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (code: ErrorCode, message: string, details?: Record<string, unknown>) =>
  new AppError(409, code, message, undefined, details);
export const unprocessable = (code: ErrorCode, message: string, fields?: Record<string, string>) =>
  new AppError(422, code, message, fields);
