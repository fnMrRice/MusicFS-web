import { expect, it } from 'vitest';
import { RecoveryBudget } from '../../../src/player/recovery';
it('deduplicates the same failure and limits total automatic attempts', () => {
  const budget = new RecoveryBudget(); expect(budget.allow('a1', 1000)).toBe(true);
  expect(budget.allow('a1', 1100)).toBe(false); expect(budget.allow('a2', 1200)).toBe(true);
  expect(budget.allow('a3', 1300)).toBe(false);
});
it('never resets the elapsed recovery budget for a new attempt', () => {
  const budget = new RecoveryBudget(); expect(budget.allow('a1', 1000)).toBe(true);
  expect(budget.allow('a2', 31_001)).toBe(false);
});
