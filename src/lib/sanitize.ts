import DOMPurify from 'dompurify';

/**
 * Sanitizes HTML content to prevent XSS attacks.
 * This should be used for any user-controlled or admin-controlled HTML 
 * that will be rendered using dangerouslySetInnerHTML.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
      'b', 'i', 'u', 'br', 'ul', 'ol', 'li', 
      'a', 'img', 'strong', 'em', 'span', 'div',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'hr', 'blockquote', 'pre', 'code', 'sub', 'sup'
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'class', 'style',
      'width', 'height', 'target', 'rel', 'dir', 'align',
      'colspan', 'rowspan', 'border', 'cellpadding', 'cellspacing'
    ],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur']
  });
}

/**
 * Creates sanitized HTML object for use with dangerouslySetInnerHTML
 */
export function createSafeHtml(html: string | null | undefined): { __html: string } {
  return { __html: sanitizeHtml(html) };
}
