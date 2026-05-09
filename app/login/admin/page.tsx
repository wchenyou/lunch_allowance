import { LoginForm } from "@/app/login/LoginForm";
import { loginConfigs } from "@/app/login/config";

export default function AdminLoginPage() {
  return <LoginForm config={loginConfigs.admin} />;
}
