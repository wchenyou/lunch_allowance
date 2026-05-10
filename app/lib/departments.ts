const SYSTEM_DEPARTMENT_CODES = new Set(["system", "sys_admin", "super_admin", "admin"]);
const SYSTEM_DEPARTMENT_NAMES = new Set(["系統管理", "系統管理部", "System Admin", "System Administration"]);

export function isSystemDepartment(department: { code?: string | null; name: string }) {
  return SYSTEM_DEPARTMENT_CODES.has((department.code ?? "").trim().toLowerCase()) || SYSTEM_DEPARTMENT_NAMES.has(department.name.trim());
}

export function visibleDepartments<T extends { code?: string | null; name: string }>(departments: T[]) {
  return departments.filter((department) => !isSystemDepartment(department));
}
