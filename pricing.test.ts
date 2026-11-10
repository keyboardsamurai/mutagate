import { describe, expect, it } from 'vitest';
import { discount } from './pricing';

describe('discount', () => {
  it('returns zero below ten and applies the discount at ten', () => {
    expect(discount(5)).toBe(0);
    expect(discount(10)).toBe(20);
  });
});
