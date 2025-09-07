import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [mode, setMode] = useState<"operator" | "admin">("operator");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const nav = useNavigate();

  function handleLogin(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (mode === "operator") {
      if (user === "user" && pass === "123456") {
        localStorage.setItem("auth_role", "operator");
        nav("/dashboard");
        return;
      }
      alert("Invalid operator credentials");
    } else {
      if (user === "nxrivot@gmail.com" && pass === "NX100@123") {
        localStorage.setItem("auth_role", "admin");
        nav("/admin");
        return;
      }
      alert("Invalid admin credentials");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-slate-50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-white p-6 shadow">
        <h1 className="text-xl font-bold text-emerald-700">
          Battery Pack Data Log
        </h1>
        <p className="text-xs text-slate-500">Sign in to continue</p>
        <form className="mt-4" autoComplete="off" onSubmit={handleLogin}>
          <div className="flex rounded-md border p-1">
            <button
              type="button"
              className={`flex-1 rounded px-3 py-2 text-sm ${mode === "operator" ? "bg-emerald-600 text-white" : "hover:bg-slate-50"}`}
              onClick={() => setMode("operator")}
            >
              Operator
            </button>
            <button
              type="button"
              className={`flex-1 rounded px-3 py-2 text-sm ${mode === "admin" ? "bg-emerald-600 text-white" : "hover:bg-slate-50"}`}
              onClick={() => setMode("admin")}
            >
              Admin
            </button>
          </div>

          <div className="mt-4">
            <label className="text-sm font-medium">
              {mode === "admin" ? "Email" : "User ID"}
            </label>
            <Input
              className="mt-1"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              name="username"
              enterKeyHint="next"
            />
          </div>
          <div className="mt-3">
            <label className="text-sm font-medium">Password</label>
            <Input
              className="mt-1"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              // Reduce password manager prompts
              autoComplete="off"
              name="passcode"
              data-lpignore="true"
              data-1p-ignore="true"
              enterKeyHint="go"
            />
          </div>
          <Button type="submit" className="mt-5 w-full">
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
