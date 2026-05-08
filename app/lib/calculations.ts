import { Allocation, DAILY_LIMIT, Database, Employee, Receipt, ReimbursementStatus } from "./types";
import { ClaimInput, ClaimSubsidyResult, DAILY_SUBSIDY_LIMIT, ReceiptTotals } from "./domain";

export type AllocationComputed = Allocation & {
  receipt: Receipt;
  employee?: Employee;
  payer?: Employee;
  reimbursable_amount: number;
  over_limit_amount: number;
};

export type EmployeeDay = {
  date: string;
  employee_id: string;
  employee_name: string;
  total: number;
  reimbursable: number;
  over: number;
  unused: number;
};

export type PayerSummary = {
  payer_employee_id: string;
  payer_name: string;
  reimbursable: number;
  allocation_count: number;
  receipt_count: number;
};

export type ReimbursementReport = {
  start: string;
  end: string;
  payerSummaries: PayerSummary[];
  employeeDays: EmployeeDay[];
  allocations: AllocationComputed[];
};

const inRange = (date: string, start?: string, end?: string) =>
  (!start || date >= start) && (!end || date <= end);

export function calculateDailyClaimSubsidies<T extends ClaimInput>(
  claims: T[],
  dailyLimit = DAILY_SUBSIDY_LIMIT
): ClaimSubsidyResult<T>[] {
  const remainingByProfileDay = new Map<string, number>();
  const claimedBeforeByProfileDay = new Map<string, number>();

  return [...claims]
    .sort((a, b) =>
      `${a.claimDate}|${a.createdAt ?? ""}|${a.id ?? ""}`.localeCompare(`${b.claimDate}|${b.createdAt ?? ""}|${b.id ?? ""}`)
    )
    .map((claim) => {
      const key = `${claim.profileId}|${claim.claimDate}`;
      const remainingBefore = remainingByProfileDay.get(key) ?? dailyLimit;
      const dailyClaimedBefore = claimedBeforeByProfileDay.get(key) ?? 0;
      const subsidyAmount = Math.max(0, Math.min(Number(claim.claimedAmount || 0), remainingBefore));
      const overLimitAmount = Math.max(0, Number(claim.claimedAmount || 0) - subsidyAmount);

      remainingByProfileDay.set(key, Math.max(0, remainingBefore - subsidyAmount));
      claimedBeforeByProfileDay.set(key, dailyClaimedBefore + Number(claim.claimedAmount || 0));

      return {
        ...claim,
        subsidyAmount,
        overLimitAmount,
        remainingBefore,
        dailyClaimedBefore
      };
    });
}

export function summarizeReceiptTotals(totalAmount: number, claims: Array<{ claimedAmount: number; subsidyAmount: number; reimbursedAmount?: number }>): ReceiptTotals {
  const claimedAmount = claims.reduce((sum, claim) => sum + Number(claim.claimedAmount || 0), 0);
  const subsidyAmount = claims.reduce((sum, claim) => sum + Number(claim.subsidyAmount || 0), 0);
  const reimbursedAmount = claims.reduce((sum, claim) => sum + Number(claim.reimbursedAmount || 0), 0);

  return {
    totalAmount,
    claimedAmount,
    subsidyAmount,
    reimbursedAmount,
    unclaimedAmount: Math.max(0, totalAmount - claimedAmount)
  };
}

export function getReceiptAllocationTotal(receipt: Receipt, allocations: Allocation[]) {
  return allocations
    .filter((allocation) => allocation.receipt_id === receipt.receipt_id)
    .reduce((sum, allocation) => sum + allocation.amount, 0);
}

export function buildReimbursementReport(db: Database, start = "", end = ""): ReimbursementReport {
  const employees = new Map(db.employees.map((employee) => [employee.employee_id, employee]));
  const receipts = new Map(db.receipts.map((receipt) => [receipt.receipt_id, receipt]));
  const remainingByEmployeeDay = new Map<string, number>();
  const dayTotals = new Map<string, EmployeeDay>();

  const sortedAllocations = db.allocations
    .filter((allocation) => inRange(allocation.date, start, end))
    .sort((a, b) =>
      `${a.date}|${a.created_at}|${a.allocation_id}`.localeCompare(`${b.date}|${b.created_at}|${b.allocation_id}`)
    );

  const computed: AllocationComputed[] = [];

  for (const allocation of sortedAllocations) {
    const receipt = receipts.get(allocation.receipt_id);
    if (!receipt) continue;

    const employee = employees.get(allocation.employee_id);
    const payer = employees.get(receipt.payer_employee_id);
    const dayKey = `${allocation.employee_id}|${allocation.date}`;
    const remaining = remainingByEmployeeDay.get(dayKey) ?? DAILY_LIMIT;
    const reimbursable = Math.max(0, Math.min(allocation.amount, remaining));
    remainingByEmployeeDay.set(dayKey, Math.max(0, remaining - reimbursable));

    const totalDay = dayTotals.get(dayKey) ?? {
      date: allocation.date,
      employee_id: allocation.employee_id,
      employee_name: employee?.name ?? "Unknown",
      total: 0,
      reimbursable: 0,
      over: 0,
      unused: DAILY_LIMIT
    };
    totalDay.total += allocation.amount;
    totalDay.reimbursable += reimbursable;
    totalDay.over = Math.max(0, totalDay.total - DAILY_LIMIT);
    totalDay.unused = Math.max(0, DAILY_LIMIT - totalDay.total);
    dayTotals.set(dayKey, totalDay);

    computed.push({
      ...allocation,
      receipt,
      employee,
      payer,
      reimbursable_amount: reimbursable,
      over_limit_amount: allocation.amount - reimbursable
    });
  }

  const payerMap = new Map<string, PayerSummary>();
  for (const allocation of computed) {
    const payerId = allocation.receipt.payer_employee_id;
    const current = payerMap.get(payerId) ?? {
      payer_employee_id: payerId,
      payer_name: allocation.payer?.name ?? "Unknown",
      reimbursable: 0,
      allocation_count: 0,
      receipt_count: 0
    };
    current.reimbursable += allocation.reimbursable_amount;
    current.allocation_count += 1;
    payerMap.set(payerId, current);
  }

  for (const summary of payerMap.values()) {
    summary.receipt_count = new Set(
      computed
        .filter((allocation) => allocation.receipt.payer_employee_id === summary.payer_employee_id)
        .map((allocation) => allocation.receipt_id)
    ).size;
  }

  return {
    start,
    end,
    payerSummaries: [...payerMap.values()].sort((a, b) => b.reimbursable - a.reimbursable),
    employeeDays: [...dayTotals.values()].sort((a, b) => `${b.date}|${a.employee_name}`.localeCompare(`${a.date}|${b.employee_name}`)),
    allocations: computed
  };
}

export function normalizeStatus(status: string | undefined): ReimbursementStatus {
  if (status === "claimed" || status === "paid") return status;
  return "pending";
}
