import { describe, expect, it } from 'vitest';
import { discount } from './pricing';

describe('discount', () => {
  it('returns no discount for counts below 10', () => {
    expect(discount(0)).toBe(0);
    expect(discount(9)).toBe(0);
  });

  it('returns a 20 percent discount for counts of 10 or more', () => {
    expect(discount(10)).toBe(20);
    expect(discount(11)).toBe(20);
  });
});
