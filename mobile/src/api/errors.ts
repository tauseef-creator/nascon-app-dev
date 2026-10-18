// Maps backend error codes to plain-language messages (docs/MOBILE_API.md).
// Codes and HTTP numbers are never shown to the user.
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
  FORBIDDEN: "You don't have permission to do that.",
  OUT_OF_STOCK: 'Sorry, this item just sold out.',
  PAYMENT_DECLINED: 'Your payment was declined. Try another card.',
  PAYMENT_CAPTURE_FAILED: "Payment couldn't be completed. You were not charged.",
  INVALID_DISCOUNT_CODE: "That discount code isn't valid.",
  TRANSFER_WINDOW_CLOSED: 'The transfer window is closed for that date.',
  SQUAD_FULL: 'The destination squad is already full.',
  ROSTER_NOT_CONFIGURED: 'This club does not have a roster yet.',
  DUPLICATE_PLAYER_ID: 'This player was already added. Refresh the roster to see the latest list.',
  MIN_POSITION_VIOLATION: 'This move would leave the squad short in that position.',
  PLAYER_ON_LOAN: 'This player is currently on loan.',
  NOT_IN_SQUAD: 'This player is not in the selected squad.',
  MATCH_NOT_IN_PROGRESS: 'Scores can only be added while the match is live.',
  INVALID_COMPENSATION: 'That event was already corrected.',
  RATE_LIMITED: 'Too many requests. Please wait a moment.',
  NETWORK: "You're offline. Your action was saved and will sync automatically.",
  // Extra codes the backend can return, in the same plain style.
  VALIDATION_ERROR: 'Some details are missing or not valid. Please check and try again.',
  INVALID_BASE_VERSION: 'This change was based on newer data than the server has, so the server kept its version.',
  DUPLICATE_EVENT_ID: 'This score event was already recorded.',
  DUPLICATE_REQUEST_ID: 'This roster request was already sent.',
  DUPLICATE_ORDER_ID: 'This order was already placed.',
  CROSS_TENANT_TRANSFER: 'Players can only move between clubs of the same organisation.',
  MATCH_NOT_FOUND: "We couldn't find that match.",
  PLAYER_NOT_FOUND: "We couldn't find that player.",
  SQUAD_NOT_FOUND: "We couldn't find that squad.",
  LEAGUE_NOT_FOUND: "We couldn't find that league.",
  EVENT_NOT_FOUND: "We couldn't find the event you tried to correct.",
  VARIANT_NOT_FOUND: 'That product option is no longer available.',
  NOT_FOUND: "We couldn't find what you were looking for.",
  ILLEGAL_TRANSITION: "This change isn't possible for a match in its current state.",
  UNKNOWN_EVENT_TYPE: "This sport doesn't use that kind of score event.",
  INNINGS_COMPLETE: 'This innings is already complete.',
  SERIES_ALREADY_DECIDED: 'This series has already been decided.',
  TIMEOUT: 'The server took too long to answer. Please try again.',
};

export const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

export function messageFor(code: string | null | undefined): string {
  if (!code) return GENERIC_MESSAGE;
  return MESSAGES[code] ?? GENERIC_MESSAGE;
}

export class AppError extends Error {
  code: string;
  status: number;
  details: unknown;
  constructor(code: string, status = 0, details: unknown = null, message?: string) {
    super(message ?? messageFor(code));
    this.code = code;
    this.status = status;
    this.details = details;
  }
  get isNetwork() {
    return this.code === 'NETWORK' || this.code === 'TIMEOUT';
  }
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  return new AppError('UNKNOWN');
}

/** Plain-language text for any thrown value. */
export function errorText(e: unknown): string {
  return toAppError(e).message;
}
