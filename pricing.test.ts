import { describe, expect, it } from 'vitest';
import { discount } from './pricing';

describe('discount', () => {
  it('returns zero when the count is below ten', () => {
    expect(discount(5)).toBe(0);
  });
});
