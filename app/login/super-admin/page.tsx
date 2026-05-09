import { LoginForm } from "@/app/login/LoginForm";
import { loginConfigs } from "@/app/login/config";

export default function SuperAdminLoginPage() {
  return <LoginForm config={loginConfigs.superAdmin} />;
}
