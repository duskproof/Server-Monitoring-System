import { compare, extractMetric } from './metric-extractor';

describe('extractMetric', () => {
  const metrics = {
    cpu: { percent: 92.5, load_1m: 3.2, temperature: 61 },
    memory: { used_percent: 78.4, swap_used_percent: 0 },
    disk: [
      { mount: '/', used_percent: 55, free_gb: 18 },
      { mount: '/data', used_percent: 91, free_gb: 4 },
    ],
    network: {
      eth0: { rx_speed_bps: 1000, tx_speed_bps: 4000 },
      eth1: { rx_speed_bps: 9000, tx_speed_bps: 100 },
    },
    security: { failed_ssh_attempts: 12 },
    ssl: [
      { domain: 'a.example.com', days_left: 89 },
      { domain: 'b.example.com', days_left: 6 },
    ],
    process_summary: { total: 120, zombie: 2 },
  };

  it('reads simple nested numeric values', () => {
    expect(extractMetric(metrics, 'cpu.percent')).toEqual({ value: 92.5 });
    expect(extractMetric(metrics, 'memory.used_percent')).toEqual({ value: 78.4 });
  });

  it('picks the fullest filesystem for usage metrics', () => {
    expect(extractMetric(metrics, 'disk.used_percent')).toEqual({ value: 91, label: '/data' });
  });

  it('picks the emptiest filesystem for headroom metrics', () => {
    expect(extractMetric(metrics, 'disk.free_gb')).toEqual({ value: 4, label: '/data' });
  });

  it('picks the busiest network interface', () => {
    expect(extractMetric(metrics, 'network.rx_speed_bps')).toEqual({ value: 9000, label: 'eth1' });
  });

  it('picks the certificate closest to expiry', () => {
    expect(extractMetric(metrics, 'ssl.days_left')).toEqual({
      value: 6,
      label: 'b.example.com',
    });
  });

  it('returns null for absent metrics instead of throwing', () => {
    expect(extractMetric({}, 'cpu.percent')).toBeNull();
    expect(extractMetric(metrics, 'nope.missing')).toBeNull();
  });

  it('falls back to a generic nested lookup', () => {
    expect(extractMetric(metrics, 'process_summary.zombie')).toEqual({ value: 2 });
  });
});

describe('compare', () => {
  it.each([
    [95, '>', 90, true],
    [85, '>', 90, false],
    [5, '<', 15, true],
    [1, '==', 1, true],
    [1, '!=', 2, true],
    [1, '~=', 1, false],
  ])('compares %s %s %s', (value, condition, threshold, expected) => {
    expect(compare(value as number, condition as string, threshold as number)).toBe(expected);
  });
});
