export const DAILY_SUBSIDY_LIMIT = 150;
export const RECEIPT_IMAGE_BUCKET = "receipt-images";

export type LegacyAppRole = "admin" | "hr" | "manager" | "employee";
export type AppRole = "super_admin" | "department_admin" | "employee";
export type ProfileRole = LegacyAppRole | AppRole;
export type ReceiptStatus = "draft" | "submitted" | "approved" | "rejected" | "settled" | "void";
export type ClaimStatus = "claimed" | "approved" | "rejected" | "reimbursed";
export type SettlementStatus = "draft" | "locked" | "paid" | "void";

export type Department = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  employee_no: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  department_id: string | null;
  role: LegacyAppRole;
  app_role?: AppRole;
  password_hash?: string | null;
  password_updated_at?: string | null;
  active: boolean;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReceiptRecord = {
  id: string;
  receipt_date: string;
  department_id: string | null;
  submitted_by: string;
  payer_profile_id: string | null;
  merchant: string | null;
  receipt_no: string | null;
  currency: "TWD" | string;
  total_amount: number;
  claimed_amount: number;
  subsidy_amount: number;
  reimbursed_amount: number;
  status: ReceiptStatus;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ReceiptClaim = {
  id: string;
  receipt_id: string;
  profile_id: string;
  claim_date: string;
  claimed_amount: number;
  subsidy_amount: number;
  reimbursed_amount: number;
  status: ClaimStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type ReceiptAttachment = {
  id: string;
  receipt_id: string;
  uploaded_by: string;
  bucket: typeof RECEIPT_IMAGE_BUCKET;
  object_path: string;
  content_type: string | null;
  size_bytes: number | null;
  checksum: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
};

export type ClaimInput = {
  id?: string;
  profileId: string;
  claimDate: string;
  claimedAmount: number;
  createdAt?: string;
};

export type ClaimSubsidyResult<T extends ClaimInput = ClaimInput> = T & {
  subsidyAmount: number;
  overLimitAmount: number;
  remainingBefore: number;
  dailyClaimedBefore: number;
};

export type ReceiptTotals = {
  totalAmount: number;
  claimedAmount: number;
  subsidyAmount: number;
  reimbursedAmount: number;
  unclaimedAmount: number;
};
