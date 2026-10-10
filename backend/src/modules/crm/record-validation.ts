import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';

// Record fields are plain text, including notes; HTML is never stored as markup.
export const recordText = (max = 2000) => z.string().max(max).transform(value =>
  sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim());
export const recordName = (max = 100) => recordText(max).pipe(z.string().min(1, 'Name is required'));
