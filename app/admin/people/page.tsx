import { KeyRound, Mail, ShieldCheck, UserPlus, Users } from "lucide-react";
import Link from "next/link";

export default function AdminPeoplePage() {
  return (
    <div className="app-shell admin-skeleton">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">午</div>
          <div>
            <strong>Lunch Admin</strong>
            <span>Supabase phase 1</span>
          </div>
        </div>
        <nav>
          <Link className="nav-btn" href="/">
            <Users size={16} />
            現有後台
          </Link>
          <Link className="nav-btn active" href="/admin/people">
            <UserPlus size={16} />
            人員與帳號
          </Link>
          <Link className="nav-btn" href="/employee">
            <Mail size={16} />
            員工端
          </Link>
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">管理端 / Supabase Auth Admin API</p>
            <h1>人員與帳號管理</h1>
          </div>
        </header>

        <section className="grid two narrow">
          <div className="panel">
            <div className="panel-title">
              <UserPlus size={17} />
              <h2>新增人員與登入帳號</h2>
            </div>
            <form className="form-grid single">
              <label>
                姓名
                <input placeholder="員工姓名" />
              </label>
              <label>
                Email
                <input type="email" placeholder="name@company.com" />
              </label>
              <label>
                員工編號
                <input placeholder="可選填" />
              </label>
              <label>
                部門
                <select defaultValue="">
                  <option value="" disabled>
                    選擇部門
                  </option>
                  <option>行政部</option>
                  <option>業務部</option>
                  <option>研發部</option>
                </select>
              </label>
              <label>
                角色
                <select defaultValue="employee">
                  <option value="employee">employee</option>
                  <option value="manager">manager</option>
                  <option value="hr">hr</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <label>
                初始密碼
                <input type="password" placeholder="留空則由後續邀請流程補上" />
              </label>
              <button type="button" className="primary-btn">
                <KeyRound size={16} />
                建立帳號
              </button>
            </form>
          </div>

          <div className="panel">
            <div className="panel-title">
              <ShieldCheck size={17} />
              <h2>權限設計</h2>
            </div>
            <div className="role-list">
              <Role label="admin" detail="管理所有部門、人員、審核、代建發票與結算。" />
              <Role label="hr" detail="管理人員與帳號，讀取所有請款資料。" />
              <Role label="manager" detail="審核與查看部門資料，可代建收據。" />
              <Role label="employee" detail="手機端登入，上傳自己的收據與共同請款明細。" />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Role({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="role-item">
      <strong>{label}</strong>
      <span>{detail}</span>
    </div>
  );
}
