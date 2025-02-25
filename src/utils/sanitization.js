// utils/sanitization.js
export function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    // Remove potential SQL injection characters and HTML tags
    return input
      .replace(/['";]/g, '')
      .replace(/<[^>]*>?/g, '');
  }