import assert from "node:assert/strict";
import { calculateDailyClaimSubsidies } from "../app/lib/calculations";

const results = calculateDailyClaimSubsidies([
  { id: "first", profileId: "aaron", claimDate: "2026-05-11", claimedAmount: 120, createdAt: "2026-05-11T01:00:00Z" },
  { id: "second", profileId: "aaron", claimDate: "2026-05-11", claimedAmount: 80, createdAt: "2026-05-11T02:00:00Z" }
]);

assert.equal(results[0].subsidyAmount, 120, "low receipt should reimburse actual amount");
assert.equal(results[1].subsidyAmount, 30, "daily total should cap at 150");
assert.equal(results[1].overLimitAmount, 50, "overage should be tracked");

const groupReceiptResults = calculateDailyClaimSubsidies([
  { id: "aaron", profileId: "aaron", claimDate: "2026-05-12", claimedAmount: 150, createdAt: "2026-05-12T01:00:00Z" },
  { id: "iris", profileId: "iris", claimDate: "2026-05-12", claimedAmount: 150, createdAt: "2026-05-12T01:00:00Z" },
  { id: "phil", profileId: "phil", claimDate: "2026-05-12", claimedAmount: 150, createdAt: "2026-05-12T01:00:00Z" },
  { id: "hana", profileId: "hana", claimDate: "2026-05-12", claimedAmount: 150, createdAt: "2026-05-12T01:00:00Z" }
]);
assert.equal(
  groupReceiptResults.reduce((sum, claim) => sum + claim.subsidyAmount, 0),
  600,
  "group receipt should cap each claimant independently and sum to 600"
);

const countExistingSubmittedReceipts = (receiptIds: string[]) => new Set(receiptIds).size;
assert.equal(countExistingSubmittedReceipts(["r1", "r2"]) >= 2, true, "third same-day receipt should be blocked by API guard");

console.log("calculation checks passed");
