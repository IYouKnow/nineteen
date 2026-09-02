import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "";

export default function Login() {
  const [hasUsers, setHasUsers] = useState(null);
  const [step, setStep] = useState("code");
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API_URL}/api/auth/has-users`)
      .then((res) => res.json())
      .then((data) => {
        setHasUsers(data.has_users);
        setStep(data.has_users ? "login" : "code");
      })
      .catch(() => {
        setHasUsers(false);
        setStep("code");
      });
  }, []);

  const handleValidateCode = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/validate-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: inviteCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Invalid invite code", { description: data.error });
        return;
      }
      setStep("create");
    } catch {
      toast.error("Could not validate invite code");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async (e) => {
    e.preventDefault();
    setLoading(true);
    const result = await register(inviteCode, username, email, password, displayName);
    setLoading(false);

    if (result.success) {
      navigate("/", { replace: true });
    } else {
      toast.error("Registration failed", { description: result.error, duration: Infinity });
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const result = await login(username, password);
    setLoading(false);

    if (result.success) {
      navigate("/", { replace: true });
    } else {
      toast.error("Login failed", { description: result.error, duration: Infinity });
    }
  };

  if (hasUsers === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl font-bold">NexusCore</CardTitle>
          {step === "code" && <CardDescription>Enter your invite code to get started</CardDescription>}
          {step === "create" && <CardDescription>Create your account</CardDescription>}
          {step === "login" && <CardDescription>Sign in to your account</CardDescription>}
        </CardHeader>
        <CardContent>
          {step === "code" && (
            <form onSubmit={handleValidateCode} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="inviteCode" className="text-sm font-medium text-foreground">
                  Invite Code
                </label>
                <Input
                  id="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Enter invite code"
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full">
                Continue
              </Button>
            </form>
          )}

          {step === "create" && (
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium text-foreground">
                  Username
                </label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-foreground">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="displayName" className="text-sm font-medium text-foreground">
                  Display Name <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How should we call you?"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating account…" : "Create account"}
              </Button>
            </form>
          )}

          {step === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium text-foreground">
                  Username
                </label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
