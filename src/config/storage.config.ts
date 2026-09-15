/** Fallback when PAYMENT_SCREENSHOT_MAX_BYTES is not set in .env (200 KB) */
export const DEFAULT_PAYMENT_SCREENSHOT_MAX_BYTES = 200 * 1024;

/** Single source: read PAYMENT_SCREENSHOT_MAX_BYTES from the environment */
export function getPaymentScreenshotMaxBytes(): number {
  const raw = process.env.PAYMENT_SCREENSHOT_MAX_BYTES?.trim();
  if (!raw) {
    return DEFAULT_PAYMENT_SCREENSHOT_MAX_BYTES;
  }

  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_PAYMENT_SCREENSHOT_MAX_BYTES;
}
