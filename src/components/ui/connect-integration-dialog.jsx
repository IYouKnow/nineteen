import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { CheckCircle2, Loader2, Eye, EyeOff, FolderGit2, Building2, UserRound } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

function getAuthHeaders() {
  const token = localStorage.getItem("nineteen_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export function ConnectIntegrationDialog({ provider, open, onClose, onConnect }) {
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  function handleClose() {
    setToken("");
    setLabel("");
    setShowToken(false);
    setTestResult(null);
    setError(null);
    onClose();
  }

  useEffect(() => {
    const trimmed = token.trim();
    if (!trimmed) {
      setTestResult(null);
      setError(null);
      setTesting(false);
      return;
    }
    setError(null);
    setTestResult(null);
    const timer = setTimeout(() => {
      runTest(trimmed);
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function runTest(tok) {
    setTesting(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/integrations/test`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ provider: provider.id, access_token: tok }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test failed");
      setTestResult(data);
      setError(null);
    } catch (err) {
      setError(err.message);
      setTestResult(null);
    } finally {
      setTesting(false);
    }
  }

  async function handleConnect() {
    if (!testResult) return;
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/settings/integrations`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          provider: provider.id,
          access_token: token,
          label: label.trim() || provider.name,
          config: "{}",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed");
      onConnect(data);
      handleClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {provider.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="integration-label">Label (optional)</Label>
            <Input
              id="integration-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={provider.name}
            />
            <p className="text-[11px] text-muted-foreground">
              A friendly name to identify this connection
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="integration-token">
              {provider.id === "github"
                ? "Personal Access Token"
                : "API Key"}
            </Label>
            <div className="relative">
              <Input
                id="integration-token"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={
                  provider.id === "github"
                    ? "ghp_xxxxxxxxxxxx"
                    : "Enter your token"
                }
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            {provider.id === "github" && (
              <p className="text-[11px] text-muted-foreground">
                Generate a token at{" "}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  github.com/settings/tokens
                </a>
                . Works with both classic and fine-grained tokens.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {testResult && (
            <div className="rounded-md border border-green-500/50 bg-green-500/5 p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <p className="text-sm font-medium text-foreground">
                  Token is valid
                </p>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={testResult.avatar} />
                  <AvatarFallback className="text-[10px]">
                    {testResult.username?.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-muted-foreground">
                  {testResult.name || testResult.username}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <FolderGit2 className="h-3.5 w-3.5" />
                  {testResult.repo_count} repositor{testResult.repo_count === 1 ? "y" : "ies"}
                </div>
                <div className="flex items-center gap-1.5">
                  {testResult.type === "Organization" ? (
                    <Building2 className="h-3.5 w-3.5" />
                  ) : (
                    <UserRound className="h-3.5 w-3.5" />
                  )}
                  {testResult.type === "Organization" ? "Organization" : "User"}
                </div>
              </div>
            </div>
          )}

          {testing && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Validating token…
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="white"
            disabled={!token.trim() || !testResult || connecting}
            onClick={handleConnect}
          >
            {connecting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
