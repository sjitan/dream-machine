/**
 * XSS Sanitization utility for user-provided content.
 * Prevents stored XSS attacks by stripping dangerous HTML and script content.
 */

// HTML entities for escaping
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

/**
 * Escape HTML entities to prevent XSS
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"'`=/]/g, (char) => HTML_ENTITIES[char] || char);
}

/**
 * Strip all HTML tags from text
 */
export function stripHtmlTags(text: string): string {
  // Remove script tags and their content first
  let cleaned = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove style tags and their content
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Remove all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  // Decode common HTML entities
  cleaned = cleaned.replace(/&amp;/g, '&');
  cleaned = cleaned.replace(/&lt;/g, '<');
  cleaned = cleaned.replace(/&gt;/g, '>');
  cleaned = cleaned.replace(/&quot;/g, '"');
  cleaned = cleaned.replace(/&#x27;/g, "'");
  cleaned = cleaned.replace(/&#x2F;/g, '/');
  // Now escape them again for safe storage
  return escapeHtml(cleaned);
}

/**
 * Sanitize a string for safe storage (strips HTML, escapes entities)
 * Use for: dream names, trade notes, any user-provided text
 */
export function sanitizeString(input: string | null | undefined): string {
  if (!input) return '';
  
  // Trim whitespace
  let sanitized = input.trim();
  
  // Limit length to prevent abuse (max 5000 chars for notes, 200 for names)
  if (sanitized.length > 5000) {
    sanitized = sanitized.substring(0, 5000);
  }
  
  // Strip HTML tags and escape remaining entities
  sanitized = stripHtmlTags(sanitized);
  
  // Remove null bytes and other control characters (except newlines and tabs)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  return sanitized;
}

/**
 * Sanitize a short name (dream item name, ticker, etc.)
 * Stricter limits: max 200 chars, single line
 */
export function sanitizeName(input: string | null | undefined): string {
  if (!input) return '';
  
  let sanitized = input.trim();
  
  // Limit to 200 chars for names
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200);
  }
  
  // Remove newlines for single-line names
  sanitized = sanitized.replace(/[\r\n]/g, ' ');
  
  // Strip HTML and escape
  sanitized = stripHtmlTags(sanitized);
  
  // Remove control characters
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  return sanitized;
}

/**
 * Validate and sanitize a URL
 */
export function sanitizeUrl(input: string | null | undefined): string {
  if (!input) return '';
  
  const trimmed = input.trim();
  
  // Only allow http, https protocols
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return ''; // Reject javascript:, data:, etc.
    }
    return url.toString();
  } catch {
    // If it's not a valid URL, try to make it one
    if (trimmed.startsWith('//')) {
      return 'https:' + trimmed;
    }
    if (!trimmed.startsWith('http')) {
      return 'https://' + trimmed;
    }
    return ''; // Invalid URL
  }
}

/**
 * Sanitize an entire object's string fields recursively
 */
export function sanitizeObject<T extends Record<string, unknown>>(
  obj: T,
  nameFields: string[] = ['name', 'title'],
  urlFields: string[] = ['url', 'link', 'imageUrl'],
  textFields: string[] = ['notes', 'description', 'content', 'message']
): T {
  const result = { ...obj };
  
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      if (nameFields.includes(key)) {
        (result as Record<string, unknown>)[key] = sanitizeName(value);
      } else if (urlFields.includes(key)) {
        (result as Record<string, unknown>)[key] = sanitizeUrl(value);
      } else if (textFields.includes(key)) {
        (result as Record<string, unknown>)[key] = sanitizeString(value);
      }
    }
  }
  
  return result;
}
