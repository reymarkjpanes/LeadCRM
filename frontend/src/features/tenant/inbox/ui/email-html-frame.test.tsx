import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailHtmlFrame } from './email-html-frame';

let resize: ResizeObserverCallback;
let observers: { disconnect: ReturnType<typeof vi.fn> }[];
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

beforeEach(() => {
  observers = []; frames = new Map(); nextFrame = 0;
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn();
    observe = vi.fn();
    constructor(callback: ResizeObserverCallback) { resize = callback; observers.push(this); }
  });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function loadFrame() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<EmailHtmlFrame body="<p>Original email</p>" inlineImages={{}} />); });
  const frame = view.getByTitle('Email message content') as HTMLIFrameElement;
  const body = frame.contentDocument!.body;
  Object.defineProperty(body, 'scrollHeight', { value: 100, configurable: true });
  observers.length = 0;
  fireEvent.load(frame);
  flushFrame();
  return { ...view, frame, body };
}
function flushFrame() {
  const callbacks = [...frames.values()]; frames.clear();
  act(() => callbacks.forEach(callback => callback(0)));
}

it('defers resize-driven height writes and coalesces notifications while preserving growth and shrinkage', async () => {
  const { frame, body } = await loadFrame();
  expect(frame.style.height).toBe('100px');
  Object.defineProperty(body, 'scrollHeight', { value: 240, configurable: true });
  act(() => { resize([], {} as ResizeObserver); resize([], {} as ResizeObserver); });
  expect(frame.style.height).toBe('100px');
  expect(frames.size).toBe(1);
  flushFrame(); expect(frame.style.height).toBe('240px');
  Object.defineProperty(body, 'scrollHeight', { value: 60, configurable: true });
  fireEvent(body, new Event('toggle', { bubbles: true }));
  flushFrame(); expect(frame.style.height).toBe('60px');
});

it('disconnects observers, removes listeners and cancels queued measurements on reload and unmount', async () => {
  const { frame, unmount } = await loadFrame();
  const remove = vi.spyOn(frame.contentDocument!, 'removeEventListener');
  act(() => resize([], {} as ResizeObserver));
  expect(frames.size).toBe(1);
  const previousFrame = nextFrame;
  fireEvent.load(frame);
  expect(observers[0].disconnect).toHaveBeenCalledOnce();
  expect(window.cancelAnimationFrame).toHaveBeenCalledWith(previousFrame);
  expect(frames.size).toBe(1); // Initial measurement for the newly loaded document.
  expect(remove).toHaveBeenCalledWith('load', expect.any(Function), true);
  expect(remove).toHaveBeenCalledWith('toggle', expect.any(Function), true);
  act(() => resize([], {} as ResizeObserver));
  unmount();
  expect(observers[1].disconnect).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  expect(remove).toHaveBeenCalledTimes(4);
});

it('cleans the old document before loading changed content and retains unchanged srcDoc', async () => {
  const view = await loadFrame();
  const original = view.frame.getAttribute('srcdoc');
  view.rerender(<EmailHtmlFrame body="<p>Original email</p>" inlineImages={{}} />);
  expect(view.frame.getAttribute('srcdoc')).toBe(original);
  expect(observers[0].disconnect).not.toHaveBeenCalled();
  const remove = vi.spyOn(view.frame.contentDocument!, 'removeEventListener');
  act(() => resize([], {} as ResizeObserver));
  expect(frames.size).toBe(1);
  view.rerender(<EmailHtmlFrame body="<p>Recovered message</p>" inlineImages={{}} />);
  expect(observers[0].disconnect).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledTimes(2);
  expect(frames.size).toBe(0);
  expect(view.frame.getAttribute('sandbox')).not.toContain('allow-scripts');
  expect(view.frame.getAttribute('srcdoc')).toContain("script-src 'none'");
});
it('passes the subject to distinguish Outlook forwards from reply history', () => {
  const body = '<p>Sharing</p><div id="divRplyFwdMsg">From: Sender<br>Sent: Thursday<br>To: Customer</div><p>Forwarded content</p>';
  const view = render(<EmailHtmlFrame body={body} inlineImages={{}} subject="Fwd: Proposal" />);
  const frame = view.getByTitle('Email message content');
  expect(frame.getAttribute('srcdoc')).toContain('Forwarded content');
  view.rerender(<EmailHtmlFrame body={body} inlineImages={{}} subject="Re: Proposal" />);
  expect(frame.getAttribute('srcdoc')).not.toContain('Forwarded content');
});

it('reuses only the active app fonts and normalizes sender typography without changing formatting or source HTML', () => {
  const fonts = document.createElement('style');
  fonts.textContent = '@font-face{font-family:"App Poppins";src:url(../media/regular.woff2);font-weight:400}' +
    '@font-face{font-family:"App Poppins";src:url(../media/bold.woff2);font-weight:700}' +
    '@font-face{font-family:Heading;src:url(../media/heading.woff2)}';
  document.head.append(fonts);
  Object.defineProperty(fonts.sheet!, 'href', { value: 'https://app.test/styles/fonts.css' });
  // jsdom omits font-face src descriptors; browsers retain them in cssText.
  const rules = fonts.textContent.match(/@font-face\{[^}]+\}/g)!;
  [...fonts.sheet!.cssRules].forEach((rule, index) => Object.defineProperty(rule, 'cssText', { value: rules[index] }));
  const html = '<div style="font:italic 700 24px/3 serif!important;color:red">Hello <b>bold</b> <em>italic</em>' +
    '<a href="https://example.test">link</a><br>Second line</div><pre>First\nSecond <code>code</code></pre>';
  try {
    const view = render(<EmailHtmlFrame body={html} inlineImages={{}} />);
    const frame = view.getByTitle('Email message content') as HTMLIFrameElement;
    Object.assign(frame.style, { fontFamily: '"App Poppins", sans-serif', fontSize: '13px', fontWeight: '400', lineHeight: '1.625' });
    const source = frame.getAttribute('srcdoc');
    const doc = frame.contentDocument!;
    doc.body.innerHTML = html;
    fireEvent.load(frame);
    const copiedFonts = doc.querySelector('style[data-mailbox-typography]')!.textContent;
    expect(copiedFonts).toContain('https://app.test/media/regular.woff2');
    expect(copiedFonts).toContain('https://app.test/media/bold.woff2');
    expect(copiedFonts).not.toContain('heading.woff2');
    for (const element of [doc.body, ...doc.body.querySelectorAll<HTMLElement>('*')]) {
      expect(element.style.fontFamily).toBe('"App Poppins", sans-serif');
      expect(element.style.fontSize).toBe('13px');
      expect(element.style.lineHeight).toBe('1.625');
    }
    const formatted = doc.querySelector('div')!;
    expect(doc.body.style.fontWeight).toBe('400');
    expect(formatted.style.fontWeight).toBe('700');
    expect(formatted.style.fontStyle).toBe('italic');
    expect(formatted.style.color).toBe('red');
    expect(doc.querySelector('b')?.textContent).toBe('bold');
    expect(doc.querySelector('em')?.textContent).toBe('italic');
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('https://example.test');
    expect(doc.querySelectorAll('br')).toHaveLength(1);
    expect(doc.querySelector('pre')?.textContent).toBe('First\nSecond code');
    expect(frame.getAttribute('srcdoc')).toBe(source);
    expect(source).toContain("font-src 'self'");
    expect(source).toContain("script-src 'none'");
    expect(source).toContain("connect-src 'none'");
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
    fireEvent.load(frame);
    expect(doc.querySelectorAll('style[data-mailbox-typography]')).toHaveLength(1);
  } finally { fonts.remove(); }
});

it('remeasures after fonts load and removes the font listener on unmount', async () => {
  const view = await loadFrame();
  const fonts = new EventTarget();
  Object.defineProperty(view.frame.contentDocument!, 'fonts', { value: fonts, configurable: true });
  const remove = vi.spyOn(fonts, 'removeEventListener');
  fireEvent.load(view.frame); flushFrame();
  Object.defineProperty(view.body, 'scrollHeight', { value: 160, configurable: true });
  fonts.dispatchEvent(new Event('loadingdone'));
  flushFrame();
  expect(view.frame.style.height).toBe('160px');
  view.unmount();
  expect(remove).toHaveBeenCalledWith('loadingdone', expect.any(Function));
  fonts.dispatchEvent(new Event('loadingdone'));
  expect(frames.size).toBe(0);
});
