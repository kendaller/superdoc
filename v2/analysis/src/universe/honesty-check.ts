// ---------------------------------------------------------------------------
// Honesty Check
// ---------------------------------------------------------------------------
// Verifies the accounting invariant: no silent raw-fact loss.
//
//   claimedFacts + unmappedFacts === eligibleFacts
//   eligibleFacts + ignoredFacts === totalFacts
//
// This is the Layer 1 equivalent of the raw-surface trust-anchor principle.
// ---------------------------------------------------------------------------

export type HonestyCheckResult = {
  passed: boolean;
  details?: string;
};

/**
 * Verify the honesty invariant for a single document.
 *
 * All fact counts must add up exactly. Any discrepancy means the claim engine
 * has a bug — either silently dropping facts or double-counting.
 */
export function checkHonestyInvariant(
  totalFacts: number,
  claimedFacts: number,
  ignoredFacts: number,
  unmappedFacts: number,
): HonestyCheckResult {
  const eligibleFacts = claimedFacts + unmappedFacts;
  const accountedTotal = eligibleFacts + ignoredFacts;

  if (accountedTotal !== totalFacts) {
    return {
      passed: false,
      details:
        `Total mismatch: claimed(${claimedFacts}) + unmapped(${unmappedFacts}) + ignored(${ignoredFacts}) ` +
        `= ${accountedTotal}, but totalFacts = ${totalFacts}`,
    };
  }

  return { passed: true };
}
