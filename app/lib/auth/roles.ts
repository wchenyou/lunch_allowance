import type { AppRole, LegacyAppRole, ProfileRole } from "@/app/lib/domain";

export const appRoles: AppRole[] = ["super_admin", "department_admin", "employee"];

export function toAppRole(role: ProfileRole | null | undefined): AppRole {
  if (role === "super_admin" || role === "department_admin" || role === "employee") return role;
  if (role === "admin") return "super_admin";
  if (role === "hr" || role === "manager") return "department_admin";
  return "employee";
}

export function toLegacyRole(role: AppRole): LegacyAppRole {
  if (role === "super_admin") return "admin";
  if (role === "department_admin") return "manager";
  return "employee";
}
