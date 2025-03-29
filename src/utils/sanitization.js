// utils/sanitization.js
export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  // Modified to preserve user mentions while removing potential SQL injection characters
  return input
    .replace(/['";]/g, '')
    .replace(/<(?!\@)[^>]*>?/g, ''); // This preserves <@ID> mentions
}