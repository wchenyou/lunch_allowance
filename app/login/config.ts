import type { LoginConfig } from "@/app/login/LoginForm";

export const loginConfigs = {
  employee: {
    intendedRole: "employee",
    title: "員工登入",
    description: "員工專用入口，僅顯示可登入的員工帳號。",
    icon: "employee",
    submitLabel: "進入員工端"
  },
  admin: {
    intendedRole: "department_admin",
    title: "一般管理登入",
    description: "部門行政專用入口，登入後可管理授權部門範圍。",
    icon: "admin",
    submitLabel: "進入管理端"
  },
  superAdmin: {
    intendedRole: "super_admin",
    title: "最高管理登入",
    description: "最高管理權限專用入口，請使用 super_admin 帳號或系統管理密碼。",
    icon: "super-admin",
    submitLabel: "進入最高管理後台",
    allowPasswordOnly: true
  }
} satisfies Record<string, LoginConfig>;
