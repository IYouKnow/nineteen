import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

function getAuthHeaders() {
  const token = localStorage.getItem("nineteen_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState(user?.email || "");
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ email, display_name: displayName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      localStorage.setItem("nineteen_user", JSON.stringify(data));
      toast.success("Profile updated");
    } catch (err) {
      toast.error("Update failed", { description: err.message, duration: Infinity });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setChangingPassword(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/change-password`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password updated");
    } catch (err) {
      toast.error("Change failed", { description: err.message, duration: Infinity });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      logout();
      navigate("/login", { replace: true });
    } catch (err) {
      toast.error("Delete failed", { description: err.message, duration: Infinity });
    } finally {
      setDeleting(false);
      setDeletePassword("");
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your account settings
          </p>
        </div>
      </div>

      <div className="mt-7">
        <div className="mb-3">
          <h2 className="text-sm font-medium text-foreground">Account Information</h2>
          <p className="text-xs text-muted-foreground">Update your personal details</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Username</label>
                <Input value={user?.username || ""} disabled />
                <p className="text-xs text-muted-foreground">Cannot be changed</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-foreground">Email</label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="displayName" className="text-sm font-medium text-foreground">Display Name</label>
              <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="max-w-md" />
            </div>
            <div>
              <Button type="submit" variant="white" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
            </div>
          </form>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-3">
          <h2 className="text-sm font-medium text-foreground">Change Password</h2>
          <p className="text-xs text-muted-foreground">Ensure your account stays secure</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="currentPassword" className="text-sm font-medium text-foreground">Current Password</label>
                <Input id="currentPassword" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <label htmlFor="newPassword" className="text-sm font-medium text-foreground">New Password</label>
                <Input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
              </div>
            </div>
            <div>
              <Button type="submit" variant="white" disabled={changingPassword}>{changingPassword ? "Changing…" : "Change password"}</Button>
            </div>
          </form>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-3">
          <h2 className="text-sm font-medium text-destructive">Danger Zone</h2>
          <p className="text-xs text-muted-foreground">Permanently delete your account and all associated data</p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-card p-5">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete account</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. Your account and all data will be permanently deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2 py-2">
                <label htmlFor="deletePassword" className="text-sm font-medium text-foreground">Enter your password to confirm</label>
                <Input id="deletePassword" type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Password" />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDeletePassword("")}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteAccount} disabled={deleting || !deletePassword} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {deleting ? "Deleting…" : "Delete account"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
