import { dbEntities } from "@/lib/dbEntities";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2, Eye, EyeOff } from "lucide-react";

export default function ResetPasswordDialog({ database, open, onOpenChange, onReset }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setShowPassword(false);
      setError(null);
    }
  }, [open]);

  const passwordError = password && password.length < 8 ? "At least 8 characters" : null;

  const submit = async () => {
    if (passwordError) return;
    setSaving(true);
    setError(null);
    try {
      const creds = await dbEntities.Database.resetPassword(database.id, password || undefined);
      onReset(creds);
      onOpenChange(false);
    } catch (e) {
      setError(e.message || "Failed to reset password");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> Reset password for {database?.name}
          </DialogTitle>
          <DialogDescription>
            This immediately replaces the password on the running database. Connected
            projects using the old credentials will stop working until updated.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>New password</Label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-card pr-9 font-mono"
              placeholder="Leave blank to auto-generate"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {passwordError ? (
            <p className="text-xs text-destructive">{passwordError}</p>
          ) : (
            <p className="text-xs text-muted-foreground/70">
              Optional — leave blank to auto-generate a secure password.
            </p>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !!passwordError} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Reset password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
