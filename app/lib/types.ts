export type ReimbursementStatus = "pending" | "claimed" | "paid" | "rejected";

export type Employee = {
  employee_id: string;
  name: string;
  active: boolean;
  note: string;
  department_id?: string | null;
  department_name?: string | null;
  created_at: string;
  updated_at: string;
};

export type Receipt = {
  receipt_id: string;
  date: string;
  payer_employee_id: string;
  submitted_by?: string;
  department_id?: string | null;
  applicant_name?: string;
  claimant_names?: string[];
  merchant: string;
  total_amount: number;
  claimed_amount?: number;
  subsidy_amount?: number;
  reimbursed_amount?: number;
  receipt_no: string;
  note: string;
  reimbursement_status: ReimbursementStatus;
  created_at: string;
  updated_at: string;
};

export type ReceiptAttachment = {
  attachment_id: string;
  receipt_id: string;
  bucket: string;
  object_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  public_url?: string;
  signed_url?: string;
  created_at: string;
};

export type Allocation = {
  allocation_id: string;
  receipt_id: string;
  date: string;
  employee_id: string;
  amount: number;
  note: string;
  created_at: string;
  updated_at: string;
};

export type Database = {
  employees: Employee[];
  receipts: Receipt[];
  allocations: Allocation[];
  attachments?: ReceiptAttachment[];
};

export type ReceiptInput = {
  date: string;
  payer_employee_id: string;
  merchant?: string;
  total_amount: number;
  receipt_no?: string;
  note?: string;
  reimbursement_status?: ReimbursementStatus;
  allocations: Array<{ employee_id: string; amount: number; note?: string }>;
};

export type EmployeeInput = {
  employee_id?: string;
  name: string;
  active?: boolean;
  note?: string;
};

export const DAILY_LIMIT = 150;
