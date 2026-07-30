// handlers/helpers.js
// Shared helper functions for socket event handlers.
// These are stateless utilities that don't reference module-level state.

const ratelimit = require('../ratelimit');

/**
 * Check event rate using ephemeral IP-based limiter (6h TTL).
 * Falls back to socket.id if IP is unavailable.
 */
function checkEventRate(socket, event, maxPerWindow, windowMs) {
  const ip = socket._clientIp || socket.id;
  var effectiveMax = maxPerWindow;
  return ratelimit.check(ip, event, effectiveMax, windowMs);
}

/**
 * Stricter rate check: checks BOTH per-IP AND per-socket limits.
 * This prevents shared IP addresses from being unfairly limited while
 * still preventing single-socket abuse. Both checks must pass.
 *
 * The per-IP limit uses the original max (shared budget across all sockets on that IP).
 * The per-socket limit uses a per-socket fraction (max / 2, minimum 1) to prevent
 * a single socket from consuming the entire IP budget.
 *
 * @param {object} socket - Socket.IO socket
 * @param {string} event - Event/action name
 * @param {number} maxPerWindow - Max allowed per IP in window
 * @param {number} windowMs - Time window in ms
 * @returns {boolean} true if allowed (both checks pass)
 */
function checkEventRateStrict(socket, event, maxPerWindow, windowMs) {
  const ip = socket._clientIp || socket.id;
  const socketId = socket.id;

  // Check 1: per-IP limit (shared across all sockets from this IP)
  const ipAllowed = ratelimit.check(ip, event, maxPerWindow, windowMs);
  if (!ipAllowed) return false;

  // Check 2: per-socket limit (prevents a single socket from hogging the IP budget)
  // Use a per-socket key to differentiate from the IP-level check
  const socketEvent = 'sock:' + event;
  const perSocketMax = Math.max(1, Math.floor(maxPerWindow / 2));
  const socketAllowed = ratelimit.check(socketId, socketEvent, perSocketMax, windowMs);
  if (!socketAllowed) return false;

  return true;
}

/**
 * Sanitize user-provided text.
 * 1. Strip control chars (except \n), zero-width chars
 * 2. Trim whitespace
 *
 * NOTE: No HTML entity encoding. All client rendering uses React text nodes
 * which auto-escape content. HTML encoding here caused double-encoding
 * (e.g. '&' → '&amp;' on server, React renders literal '&amp;' on screen).
 */
function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  // Remove control chars except \n, remove zero-width chars
  let cleaned = str.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
  // Strip HTML tags to prevent injection in any rendering path
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  // Strip non-standard characters — allow alphanumeric, common punctuation, newlines
  cleaned = cleaned.replace(/[^a-zA-Z0-9 _\-!?,.'":;\n@#&()\/<>+=$/\\]/g, '');
  return cleaned.trim();
}

// --- URL validation for image URLs ---

const ALLOWED_IMAGE_DOMAINS = new Set([
  'i.imgur.com',
  'imgur.com',
  'media.tenor.com',
  'media1.tenor.com',
  'media.giphy.com',
  'giphy.com',
]);

/**
 * Validate an image URL against the allowlist.
 * Only HTTPS URLs from approved domains are accepted.
 * @param {string} url - The URL to validate
 * @returns {string|null} The cleaned URL if valid, null otherwise
 */
function validateUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return null;

  // Trim whitespace
  let cleaned = url.trim();

  // Must start with https://
  if (!cleaned.startsWith('https://')) return null;

  // Parse the URL safely
  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch (_) {
    return null;
  }

  // Protocol must be https (double-check after parsing)
  if (parsed.protocol !== 'https:') return null;

  // Hostname must be in the allowlist
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_IMAGE_DOMAINS.has(hostname)) return null;

  // Reject URLs with credentials (user:pass@host)
  if (parsed.username || parsed.password) return null;

  // Return the cleaned (re-serialized) URL to normalize it
  return parsed.href;
}

module.exports = {
  checkEventRate,
  checkEventRateStrict,
  sanitizeText,
  validateUrl,
};
