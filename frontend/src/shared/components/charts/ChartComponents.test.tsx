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
it('opts into bar-end counts and wrapped source names without changing ordinary bars', () => {
  const view = render(<BarChart layout="vertical" data={[{ name: 'Social Media Advertisement', won: 123456 }]} showValueLabels wrapCategoryLabels><YAxis dataKey="name" /><Bar dataKey="won" /></BarChart>);
  const context = { save: vi.fn(), restore: vi.fn(), measureText: (value: string) => ({ width: value.length * 7 + (value.includes('…') ? 5 : 0) }), fillText: vi.fn() };
  const labels = captured.bar.options.scales.y.ticks.callback.call({ maxWidth: 120, chart: { width: 240, ctx: context } }, 0);
  expect(labels.length).toBeLessThanOrEqual(3);
  expect(labels.join(' ').replaceAll(' ', '')).toBe('SocialMediaAdvertisement');
  const narrowLabels = captured.bar.options.scales.y.ticks.callback.call({ maxWidth: 84, chart: { width: 240, ctx: context } }, 0);
  expect(narrowLabels.every((line: string) => context.measureText(line).width <= 70)).toBe(true);
  expect(captured.bar.options.scales.y.ticks.autoSkip).toBe(false);
  expect(captured.bar.options.layout.padding.right).toBeGreaterThanOrEqual(60);
  const plugin = captured.bar.plugins[0];
  plugin.afterDatasetsDraw({ ctx: context, data: captured.bar.data, options: { color: '#0f172a' }, isDatasetVisible: () => true, getDatasetMeta: () => ({ data: [{ x: 100, y: 32 }] }) });
  expect(context.fillText).toHaveBeenCalledWith('123456', 106, 32);
  expect((context as any).fillStyle).toBe('#0f172a');
  plugin.afterDatasetsDraw({ ctx: context, data: captured.bar.data, options: { color: '#f8fafc' }, isDatasetVisible: () => true, getDatasetMeta: () => ({ data: [{ x: 100, y: 32 }] }) });
  expect((context as any).fillStyle).toBe('#f8fafc');
  expect(captured.bar.options.scales.y.afterFit).toBeUndefined();
  view.rerender(<BarChart data={[{ name: 'January', won: 1 }]}><Bar dataKey="won" /></BarChart>);
  expect(captured.bar.plugins).toBeUndefined();
  expect(captured.bar.options.layout).toBeUndefined();
});
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
  expect(captured.line.data.datasets[0].pointRadius).toBe(6);
  expect(captured.line.data.datasets[0].pointHitRadius).toBe(12);
  expect(captured.line.options.scales.x.offset).toBe(true);
  expect(captured.line.options.responsive).toBe(true);
  expect(captured.line.options.maintainAspectRatio).toBe(false);
});
it('formats vertical category ticks and tooltip titles while preserving data and stage colors', () => {
  render(<BarChart data={[{ name: '2020-01-01', won: 2 }]}><XAxis dataKey="name" tickFormatter={value => value === '2020-01-01' ? 'Jan 2020' : 'wrong'} /><YAxis /><Tooltip labelFormatter={() => 'Jan 2020'} /><Bar dataKey="won" fill="#059669" /></BarChart>);
  expect(captured.bar.options.indexAxis).toBe('x');
  expect(captured.bar.options.scales.x.ticks.callback(0)).toBe('Jan 2020');
  expect(captured.bar.options.plugins.tooltip.callbacks.title([{ label: '2020-01-01' }])).toBe('Jan 2020');
  expect(captured.bar.data.datasets[0].data).toEqual([2]);
  expect(captured.bar.data.datasets[0].backgroundColor).toBe('#059669');
});
it('formats horizontal numeric ticks and category labels on the correct axes', () => {
  render(<BarChart layout="vertical" data={[{ name: 'Lead', value: 1200000000 }]}><XAxis tickFormatter={value => `₱${value}`} /><YAxis dataKey="name" tickFormatter={value => `Stage ${value}`} /><Bar dataKey="value" /></BarChart>);
  expect(captured.bar.options.scales.x.ticks.callback(1200000000)).toBe('₱1200000000');
  expect(captured.bar.options.scales.y.ticks.callback(0)).toBe('Stage Lead');
});
it('formats the actual area bucket tooltip and leaves multiple observations unchanged', () => {
  render(<AreaChart data={[{ name: '2020-01-01', revenue: 10 },{ name: '2020-02-01', revenue: 20 }]}><Tooltip labelFormatter={() => 'Jan 2020'} /><Area dataKey="revenue" /></AreaChart>);
  expect(captured.line.options.plugins.tooltip.callbacks.title([{ label: '2020-01-01' }])).toBe('Jan 2020');
  expect(captured.line.data.datasets[0].data).toEqual([10,20]);
  expect(captured.line.options.scales.x.offset).toBe(false);
  expect(captured.line.data.datasets[0].pointRadius).toBe(0);
});
it('opts into small multi-observation area markers without altering values', () => {
  render(<AreaChart data={[{ name: 'Jan', revenue: 10 }, { name: 'Feb', revenue: 20 }]}><Area dataKey="revenue" dot /></AreaChart>);
  expect(captured.line.data.datasets[0].pointRadius).toBe(4);
  expect(captured.line.data.datasets[0].data).toEqual([10, 20]);
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
