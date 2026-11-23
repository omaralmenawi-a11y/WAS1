import { describe, expect, it } from 'vitest';
import { etaSeconds, haversineMeters } from '../../src/lib/pickup/eta';

describe('eta', () => {
  it('haversine Riyadh points are about 9.2 km apart', () => {
    const d = haversineMeters({ lat: 24.7136, lng: 46.6753 }, { lat: 24.7743, lng: 46.7386 });
    expect(Math.abs(d - 9200)).toBeLessThanOrEqual(200);
  });
  it('same point is zero', () => {
    expect(haversineMeters({ lat: 1, lng: 2 }, { lat: 1, lng: 2 })).toBe(0);
  });
  it('9 km at 30 km/h is 1080 s', () => {
    expect(etaSeconds(9000, 30)).toBe(1080);
  });
  it('rounds up', () => {
    expect(etaSeconds(10, 30)).toBe(2); // 1.2 s
    expect(etaSeconds(0, 30)).toBe(0);
  });
});
