import { discount } from './pricing';
import { test, expect } from 'vitest';
test('discount', () => { expect(discount(9)).toBe(0); expect(discount(10)).toBe(20); expect(discount(11)).toBe(20); });
