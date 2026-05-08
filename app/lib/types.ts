export type ReimbursementStatus = "pending" | "claimed" | "paid";

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
  merchant: string;
  total_amount: number;
  receipt_no: string;
  note: string;
  reimbursement_status: ReimbursementStatus;
  created_at: string;
  updated_at: string;
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
