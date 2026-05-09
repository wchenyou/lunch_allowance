import { LoginForm } from "@/app/login/LoginForm";
import { loginConfigs } from "@/app/login/config";

export default function EmployeeLoginPage() {
  return <LoginForm config={loginConfigs.employee} />;
}
