import React from 'react';
import { act, render, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BarChart, Bar, XAxis, YAxis, Tooltip, AreaChart, Area } from './ChartComponents';
const captured = vi.hoisted(() => ({ bar: null as any, line: null as any }));
vi.mock('react-chartjs-2', () => ({
  Bar: (props: unknown) => { captured.bar = props; return null; },
  Line: (props: unknown) => { captured.line = props; return null; }, Doughnut: () => null,
}));
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
it('renders horizontal stage bars with official colors and formatted currency tooltips', () => {
  render(<BarChart layout="vertical" data={[{ name: 'Lead', value: 1500 }]}><YAxis dataKey="name" /><XAxis tickFormatter={value => `₱${value}`} /><Tooltip formatter={value => `₱${value}`} /><Bar dataKey="value" name="PHP" data={[{ color: '#123456' }]} /></BarChart>);
  expect(captured.bar.options.indexAxis).toBe('y'); expect(captured.bar.data.labels).toEqual(['Lead']);
  expect(captured.bar.data.datasets[0].backgroundColor).toEqual(['#123456']);
  expect(captured.bar.options.scales.y.ticks.callback(0)).toBe('Lead');
  expect(captured.bar.options.plugins.tooltip.callbacks.label({ dataset: { label: 'PHP' }, parsed: { x: 1500, y: 0 } })).toBe('PHP: ₱1500');
});
it('applies actual monetary formatting to the revenue area tooltip', () => {
  render(<AreaChart data={[{ name: '2020-01-01', revenue: 45000 }]}><XAxis dataKey="name" /><YAxis /><Tooltip formatter={value => `₱${value}`} /><Area dataKey="revenue" name="Revenue" /></AreaChart>);
  expect(captured.line.options.plugins.tooltip.callbacks.label({ dataset: { label: 'Revenue' }, parsed: { y: 45000 } })).toBe('Revenue: ₱45000');
  expect(captured.line.data.labels).toEqual(['2020-01-01']);
  expect(captured.line.data.datasets[0].data).toEqual([45000]);
  expect(captured.line.data.datasets[0].pointRadius).toBe(4);
  expect(captured.line.options.responsive).toBe(true);
  expect(captured.line.options.maintainAspectRatio).toBe(false);
});
it('anchors a zero-only revenue period at zero and formats readable calendar ticks', () => {
  render(<AreaChart data={[{ name: '2020-01-01', revenue: 0 }]}><XAxis dataKey="name" tickFormatter={() => 'Jan 2020'} /><YAxis domain={[0, 'auto']} /><Area dataKey="revenue" /></AreaChart>);
  expect(captured.line.options.scales.y.min).toBe(0);
  expect(captured.line.options.scales.y.beginAtZero).toBe(true);
  expect(captured.line.options.scales.x.ticks.callback(0)).toBe('Jan 2020');
  expect(captured.line.options.scales.x.ticks.maxRotation).toBe(0);
});
it('preserves genuinely negative revenue when a zero minimum was not requested', () => {
  render(<AreaChart data={[{ name: '2020-01-01', revenue: -100 }]}><XAxis dataKey="name" /><YAxis /><Area dataKey="revenue" /></AreaChart>);
  expect(captured.line.options.scales.y.min).toBeUndefined();
  expect(captured.line.data.datasets[0].data).toEqual([-100]);
});
it('updates axes and tooltips on an OS change while System mode is selected', () => {
  let dark = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', () => ({ matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  localStorage.setItem('app_theme', 'System');
  render(<BarChart data={[{ name: 'Lead', value: 1 }]}><XAxis dataKey="name" /><Bar dataKey="value" /></BarChart>);
  const lightAxis = captured.bar.options.scales.y.ticks.color;
  const lightTooltip = captured.bar.options.plugins.tooltip.backgroundColor;
  act(() => { dark = true; listeners.forEach(listener => listener()); });
  expect(captured.bar.options.scales.y.ticks.color).not.toBe(lightAxis);
  expect(captured.bar.options.plugins.tooltip.backgroundColor).not.toBe(lightTooltip);
});
