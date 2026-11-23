// Validation for the optional external "Apply" link on job postings.
// Mirrored on the client in client/src/lib/applicationUrl.js — keep the two in sync.

const MAX_APPLICATION_URL_LENGTH = 2048;
const HAS_SCHEME = /^[a-z][a-z0-9+-]*:/i; // no dots, so "host.tld:8080" is read as a host
const FORBIDDEN_CHARACTERS = /[\s<>"`\\]/;
const hasControlCharacter = value => Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
// Public domain names only: rejects localhost, bare hosts and IP literals.
const PUBLIC_HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i;

/**
 * Normalizes an application URL.
 * Returns '' for an empty value (no link), the normalized https/http URL when valid,
 * or null when the value is invalid or unsafe.
 */
function normalizeApplicationUrl(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > MAX_APPLICATION_URL_LENGTH || FORBIDDEN_CHARACTERS.test(trimmed) || hasControlCharacter(trimmed) || trimmed.startsWith('//')) return null;
  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url;
  try { url = new URL(candidate); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  if (!PUBLIC_HOSTNAME.test(url.hostname)) return null;
  if (url.href.length > MAX_APPLICATION_URL_LENGTH) return null;
  return url.href;
}

const isValidApplicationUrl = value => normalizeApplicationUrl(value) !== null;

module.exports = { normalizeApplicationUrl, isValidApplicationUrl, MAX_APPLICATION_URL_LENGTH };
