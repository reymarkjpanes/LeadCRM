'use client';
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { mailboxDisplayDocument } from '../services/email-html';

function applyMailboxTypography(frame: HTMLIFrameElement) {
  const parent = frame.ownerDocument, doc = frame.contentDocument;
  if (!doc?.body || !parent.defaultView) return;
  const typography = parent.defaultView.getComputedStyle(frame);
  const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, '');
  const families = new Set(typography.fontFamily.split(',').map(unquote));
  const fonts: string[] = [];
  for (const sheet of parent.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
        if (!families.has(unquote((rule as CSSFontFaceRule).style.getPropertyValue('font-family')))) continue;
        // Copied font URLs must still resolve against the application's stylesheet.
        fonts.push(rule.cssText.replace(/url\(["']?([^"')]+)["']?\)/g,
          (_, url: string) => `url("${new URL(url, sheet.href || parent.baseURI).href}")`));
      }
    } catch { /* Cross-origin stylesheets are not available to the frame. */ }
  }
  doc.querySelector('style[data-mailbox-typography]')?.remove();
  const style = doc.createElement('style');
  style.dataset.mailboxTypography = '';
  style.textContent = fonts.join('\n');
  doc.head.append(style);

  doc.body.style.setProperty('font-weight', typography.fontWeight, 'important');
  // Normalize display-only typography, including sender inline !important styles.
  // Leave emphasis, decorations, whitespace and all other email formatting intact.
  for (const element of [doc.body, ...doc.body.querySelectorAll<HTMLElement>('*')]) {
    for (const property of ['font-family', 'font-size', 'line-height']) {
      element.style.setProperty(property, typography.getPropertyValue(property), 'important');
    }
  }
}

export function EmailHtmlFrame({ body, inlineImages, subject }: { body: string; inlineImages: Record<string, string>; subject?: string }) {
  const source = useMemo(() => mailboxDisplayDocument(body || '<p>(No content)</p>', inlineImages, subject), [body, inlineImages, subject]);
  const [height, setHeight] = useState(80);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => () => { cleanup.current?.(); cleanup.current = undefined; }, [source]);
  return <iframe data-mailbox-body title="Email message content" srcDoc={source}
    // Same-origin permits parent-side styling and measurement. Scripts remain disabled by sandbox AND CSP.
    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
    className="inbox-message-typography block w-full min-w-0 max-w-full border-0 bg-white" style={{ height }}
    onLoad={event => {
      cleanup.current?.();
      const frame = event.currentTarget, doc = frame.contentDocument;
      if (!doc?.body) return;
      applyMailboxTypography(frame);
      const measure = () => {
        const margins = frame.contentWindow?.getComputedStyle(doc.body);
        const next = Math.min(20000, Math.max(48, Math.ceil(Math.max(doc.body.scrollHeight, doc.body.getBoundingClientRect().height) + (parseFloat(margins?.marginTop ?? '') || 0) + (parseFloat(margins?.marginBottom ?? '') || 0))));
        setHeight(previous => previous === next ? previous : next);
      };
      let pendingFrame: number | undefined;
      // Defer cross-document height writes until ResizeObserver delivery has finished.
      const scheduleMeasure = () => {
        if (pendingFrame !== undefined) return;
        pendingFrame = window.requestAnimationFrame(() => { pendingFrame = undefined; measure(); });
      };
      const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleMeasure);
      observer?.observe(doc.body); doc.addEventListener('load', scheduleMeasure, true); doc.addEventListener('toggle', scheduleMeasure, true);
      doc.fonts?.addEventListener('loadingdone', scheduleMeasure);
      scheduleMeasure();
      cleanup.current = () => {
        observer?.disconnect(); doc.removeEventListener('load', scheduleMeasure, true); doc.removeEventListener('toggle', scheduleMeasure, true);
        doc.fonts?.removeEventListener('loadingdone', scheduleMeasure);
        if (pendingFrame !== undefined) window.cancelAnimationFrame(pendingFrame);
      };
    }} />;
}
