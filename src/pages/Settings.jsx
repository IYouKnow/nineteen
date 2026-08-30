import { useState, useEffect } from "react";
import { useNavigate, useLocation, Routes, Route, Navigate } from "react-router-dom";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IntegrationCard } from "@/components/ui/integration-card";
import { ConnectIntegrationDialog } from "@/components/ui/connect-integration-dialog";
import { IntegrationSettingsDialog } from "@/components/ui/integration-settings-dialog";
import {
  Globe, Palette, Bell, Key, Link2, Server,
  Plus, Trash2, CheckCircle2, Sun, Moon, Monitor,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

function getAuthHeaders() {
  const token = localStorage.getItem("nineteen_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

const DEFAULT_SETTINGS = {
  app_name: "Nineteen",
  timezone: "UTC",
  language: "en",
  theme: "dark",
  font_size: "medium",
  email_notifications: "true",
  deployment_notifications: "true",
  build_failure_notifications: "true",
  marketing_emails: "false",
  default_instance_type: "starter",
  default_region: "fra1",
  auto_deploy: "true",
};

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Tokyo", "Asia/Shanghai",
  "Asia/Kolkata", "Australia/Sydney", "Pacific/Auckland",
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "ja", label: "日本語" },
  { value: "zh", label: "中文" },
];

const INSTANCE_TYPES = [
  { value: "starter", label: "Starter", desc: "512 MB RAM, 0.5 vCPU" },
  { value: "basic", label: "Basic", desc: "1 GB RAM, 1 vCPU" },
  { value: "standard", label: "Standard", desc: "2 GB RAM, 2 vCPU" },
  { value: "performance", label: "Performance", desc: "4 GB RAM, 4 vCPU" },
];

const REGIONS = [
  { value: "fra1", label: "Frankfurt (fra1)" },
  { value: "ams1", label: "Amsterdam (ams1)" },
  { value: "lhr1", label: "London (lhr1)" },
  { value: "nyc1", label: "New York (nyc1)" },
  { value: "sfo1", label: "San Francisco (sfo1)" },
  { value: "sgp1", label: "Singapore (sgp1)" },
  { value: "tky1", label: "Tokyo (tky1)" },
];

const INTEGRATION_PROVIDERS = [
  { id: "github", name: "GitHub", description: "Connect repositories for source control and CI/CD", enabled: true, icon: "github" },
  { id: "gitlab", name: "GitLab", description: "Connect GitLab repositories for source control and CI/CD", enabled: false },
  { id: "bitbucket", name: "Bitbucket", description: "Connect Bitbucket repositories for source control", enabled: false },
  { id: "dockerhub", name: "Docker Hub", description: "Container registry integration", enabled: false },
  { id: "aws", name: "AWS", description: "Amazon Web Services integration", enabled: false },
  { id: "gcp", name: "Google Cloud", description: "Google Cloud Platform integration", enabled: false },
  { id: "vercel", name: "Vercel", description: "Deploy to Vercel", enabled: false },
  { id: "netlify", name: "Netlify", description: "Deploy to Netlify", enabled: false },
  { id: "slack", name: "Slack", description: "Get notifications in Slack", enabled: false },
  { id: "discord", name: "Discord", description: "Get notifications in Discord", enabled: false },
];

function useSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const res = await fetch(`${API_URL}/api/settings`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load settings");
      const data = await res.json();
      setSettings({ ...DEFAULT_SETTINGS, ...data });
    } catch {
      setSettings({ ...DEFAULT_SETTINGS });
    } finally {
      setLoading(false);
    }
  }

  async function updateSettings(partial) {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(partial),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      setSettings((prev) => ({ ...prev, ...partial }));
      toast.success("Settings saved");
    } catch (err) {
      toast.error("Save failed", { description: err.message });
    } finally {
      setSaving(false);
    }
  }

  return { settings, loading, saving, updateSettings };
}

function SectionHeader({ icon: Icon, title, description }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
      <div>
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

function GeneralTab({ settings, saving, onSave }) {
  const [appName, setAppName] = useState(settings.app_name || "");
  const [timezone, setTimezone] = useState(settings.timezone || "UTC");
  const [language, setLanguage] = useState(settings.language || "en");

  return (
    <div className="space-y-6">
      <SectionHeader icon={Globe} title="General" description="Basic application settings" />
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="app_name">Application Name</Label>
            <Input id="app_name" value={appName} onChange={(e) => setAppName(e.target.value)} className="max-w-md" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="max-w-md"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="max-w-md"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button variant="white" disabled={saving} onClick={() => onSave({ app_name: appName, timezone, language })}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ThemePreview({ theme: t }) {
  const isDark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <div className={cn(
      "relative h-28 w-full overflow-hidden rounded-md border p-1.5",
      isDark ? "border-white/10 bg-[#0d1117]" : "border-black/10 bg-[#f6f8fa]"
    )}>
      <div className="flex h-full gap-1.5">
        <div className={cn(
          "flex w-[28%] flex-col gap-1 rounded-sm p-1.5",
          isDark ? "bg-[#161b22]" : "bg-[#eaeef2]"
        )}>
          <div className={cn("h-1 w-4 rounded-full", isDark ? "bg-[#30363d]" : "bg-[#d0d7de]")} />
          <div className={cn("h-1 w-6 rounded-full", isDark ? "bg-[#21262d]" : "bg-[#d8dee4]")} />
          <div className={cn("h-1 w-5 rounded-full", isDark ? "bg-[#21262d]" : "bg-[#d8dee4]")} />
          <div className={cn("h-1 w-4 rounded-full", isDark ? "bg-[#21262d]" : "bg-[#d8dee4]")} />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <div className={cn("h-1.5 w-12 rounded-full", isDark ? "bg-[#30363d]" : "bg-[#d0d7de]")} />
          <div className="flex flex-1 flex-col gap-1 rounded-sm p-1.5" style={{ background: "transparent" }}>
            <div className={cn("h-1 w-3/4 rounded-full", isDark ? "bg-[#21262d]" : "bg-[#e1e4e8]")} />
            <div className={cn("h-1 w-1/2 rounded-full", isDark ? "bg-[#21262d]" : "bg-[#e1e4e8]")} />
            <div className={cn("h-1 w-2/3 rounded-full", isDark ? "bg-[#21262d]" : "bg-[#e1e4e8]")} />
            <div className="mt-auto flex gap-1">
              <div className={cn("h-1.5 w-8 rounded-sm", isDark ? "bg-[#238636]" : "bg-[#2da44e]")} />
              <div className={cn("h-1.5 w-6 rounded-sm", isDark ? "bg-[#30363d]" : "bg-[#d0d7de]")} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeCard({ label, description, icon: Icon, value: themeValue, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col gap-3 rounded-lg border-2 p-3 transition-all cursor-pointer text-left",
        "hover:border-foreground/20",
        selected
          ? "border-foreground shadow-sm"
          : "border-border"
      )}
    >
      <ThemePreview theme={themeValue} />
      <div className="flex items-center gap-2 px-1">
        <Icon className={cn("h-4 w-4 shrink-0", selected ? "text-foreground" : "text-muted-foreground")} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground leading-none">{label}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-none">{description}</p>
        </div>
      </div>
      {selected && (
        <div className="absolute right-2 top-2">
          <CheckCircle2 className="h-4 w-4 text-foreground" />
        </div>
      )}
    </button>
  );
}

function AppearanceTab({ settings, onSave }) {
  const { theme, setTheme } = useTheme();
  const [fontSize, setFontSize] = useState(settings.font_size || "medium");

  function handleThemeChange(value) {
    setTheme(value);
    onSave({ theme: value });
  }

  function handleFontSizeChange(value) {
    setFontSize(value);
    onSave({ font_size: value });
  }

  return (
    <div className="space-y-6">
      <SectionHeader icon={Palette} title="Appearance" description="Customize how the app looks" />
      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="space-y-3">
            <Label>Theme</Label>
            <div className="grid grid-cols-3 gap-3">
              <ThemeCard
                value="light"
                label="Light"
                description="Always use light mode"
                icon={Sun}
                selected={theme === "light"}
                onClick={() => handleThemeChange("light")}
              />
              <ThemeCard
                value="dark"
                label="Dark"
                description="Always use dark mode"
                icon={Moon}
                selected={theme === "dark"}
                onClick={() => handleThemeChange("dark")}
              />
              <ThemeCard
                value="system"
                label="System"
                description="Match your OS setting"
                icon={Monitor}
                selected={theme === "system"}
                onClick={() => handleThemeChange("system")}
              />
            </div>
          </div>
          <Separator />
          <div className="space-y-3">
            <Label>Font Size</Label>
            <Select value={fontSize} onValueChange={handleFontSizeChange}>
              <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="small">Small</SelectItem>
                <SelectItem value="medium">Medium (Default)</SelectItem>
                <SelectItem value="large">Large</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NotificationsTab({ settings, onSave }) {
  const [emailNotifs, setEmailNotifs] = useState(settings.email_notifications === "true");
  const [deployNotifs, setDeployNotifs] = useState(settings.deployment_notifications === "true");
  const [buildNotifs, setBuildNotifs] = useState(settings.build_failure_notifications === "true");
  const [marketing, setMarketing] = useState(settings.marketing_emails === "true");

  function handleToggle(key, value, setter) {
    setter(value);
    onSave({ [key]: String(value) });
  }

  return (
    <div className="space-y-6">
      <SectionHeader icon={Bell} title="Notifications" description="Manage your notification preferences" />
      <Card>
        <CardContent className="pt-6 space-y-5">
          {[
            { label: "Email Notifications", desc: "Receive notifications via email", checked: emailNotifs, onCheckedChange: (v) => handleToggle("email_notifications", v, setEmailNotifs) },
            { label: "Deployment Notifications", desc: "Get notified when deployments start, succeed, or fail", checked: deployNotifs, onCheckedChange: (v) => handleToggle("deployment_notifications", v, setDeployNotifs) },
            { label: "Build Failure Alerts", desc: "Immediate alerts when builds fail", checked: buildNotifs, onCheckedChange: (v) => handleToggle("build_failure_notifications", v, setBuildNotifs) },
            { label: "Marketing Emails", desc: "Product updates and announcements", checked: marketing, onCheckedChange: (v) => handleToggle("marketing_emails", v, setMarketing) },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <Switch checked={item.checked} onCheckedChange={item.onCheckedChange} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ApiKeysTab() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => { fetchKeys(); }, []);

  async function fetchKeys() {
    try {
      const res = await fetch(`${API_URL}/api/settings/api-keys`, { headers: getAuthHeaders() });
      const data = await res.json();
      setKeys(data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  async function createKey() {
    setCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/api-keys`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCreatedKey(data.key);
      setNewKeyName("");
      fetchKeys();
      toast.success("API key created");
    } catch (err) {
      toast.error("Creation failed", { description: err.message });
    } finally { setCreating(false); }
  }

  async function deleteKey(id) {
    setDeleting(id);
    try {
      const res = await fetch(`${API_URL}/api/settings/api-keys/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to delete");
      setKeys((prev) => prev.filter((k) => k.id !== id));
      toast.success("API key deleted");
    } catch (err) {
      toast.error("Delete failed", { description: err.message });
    } finally { setDeleting(null); }
  }

  return (
    <div className="space-y-6">
      <SectionHeader icon={Key} title="API Keys" description="Manage API keys for external access" />
      <Card>
        <CardContent className="pt-6">
          {createdKey && (
            <div className="mb-4 rounded-md border border-success/50 bg-success/5 p-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-success shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">API Key Created</p>
                  <p className="mt-1 text-xs text-muted-foreground">Copy this key now — it won&apos;t be shown again.</p>
                  <code className="mt-2 block rounded bg-muted px-2 py-1 font-mono text-xs">{createdKey}</code>
                </div>
              </div>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setCreatedKey(null)}>Done</Button>
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">{keys.length} key{keys.length !== 1 ? "s" : ""}</p>
            <Button variant="white" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Create Key
            </Button>
          </div>

          {loading ? (
            <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : keys.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No API keys yet. Create one to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{k.prefix}…</code></TableCell>
                    <TableCell className="text-muted-foreground text-xs">{new Date(k.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteKey(k.id)} disabled={deleting === k.id}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="key_name">Key Name</Label>
            <Input id="key_name" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="e.g. CI/CD Pipeline" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setNewKeyName(""); }}>Cancel</Button>
            <Button variant="white" disabled={creating || !newKeyName.trim()} onClick={createKey}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IntegrationsTab() {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(null);
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [selectedIntegration, setSelectedIntegration] = useState(null);

  useEffect(() => { fetchIntegrations(); }, []);

  async function fetchIntegrations() {
    try {
      const res = await fetch(`${API_URL}/api/settings/integrations`, { headers: getAuthHeaders() });
      const data = await res.json();
      setIntegrations(data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  function getIntegrationsForProvider(providerId) {
    return integrations.filter((ig) => ig.provider === providerId);
  }

  function handleConnect(provider) {
    setSelectedProvider(provider);
    setShowConnectDialog(true);
  }

  function handleConnectComplete(data) {
    toast.success(`${selectedProvider.name} connected`);
    fetchIntegrations();
    setShowConnectDialog(false);
    setSelectedProvider(null);
  }

  function handleSettings(integration) {
    setSelectedIntegration(integration);
    setShowSettingsDialog(true);
  }

  function handleSettingsSave(updated) {
    toast.success("Integration updated");
    fetchIntegrations();
    setShowSettingsDialog(false);
    setSelectedIntegration(null);
  }

  async function handleDisconnect(integration) {
    try {
      const res = await fetch(`${API_URL}/api/settings/integrations?provider=${integration.provider}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to disconnect");
      setIntegrations((prev) => prev.filter((ig) => ig.id !== integration.id));
      toast.success(`${integration.provider} disconnected`);
    } catch (err) {
      toast.error("Disconnect failed", { description: err.message });
    }
  }

  const enabledProviders = INTEGRATION_PROVIDERS.filter((p) => p.enabled !== false);
  const disabledProviders = INTEGRATION_PROVIDERS.filter((p) => p.enabled === false);

  return (
    <div className="space-y-6">
      <SectionHeader icon={Link2} title="Integrations" description="Connect third-party services" />
      {loading ? (
        <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : (
        <div className="space-y-6">
          {enabledProviders.length > 0 && (
            <div className="space-y-3">
              {enabledProviders.map((provider) => {
                const providerIntegrations = getIntegrationsForProvider(provider.id);
                return (
                  <div key={provider.id} className="space-y-3">
                    {providerIntegrations.length > 0 ? (
                      providerIntegrations.map((ig) => (
                        <IntegrationCard
                          key={ig.id}
                          provider={provider}
                          integration={ig}
                          onConnect={() => handleConnect(provider)}
                          onDisconnect={handleDisconnect}
                          onSettings={handleSettings}
                          connecting={connecting === provider.id}
                        />
                      ))
                    ) : (
                      <IntegrationCard
                        provider={provider}
                        integration={null}
                        onConnect={() => handleConnect(provider)}
                        onDisconnect={handleDisconnect}
                        onSettings={handleSettings}
                        connecting={connecting === provider.id}
                      />
                    )}
                    {providerIntegrations.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => handleConnect(provider)}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add another {provider.name} account
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {disabledProviders.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Coming Soon
              </p>
              {disabledProviders.map((provider) => (
                <IntegrationCard
                  key={provider.id}
                  provider={provider}
                  integration={null}
                  onConnect={() => {}}
                  onDisconnect={() => {}}
                  onSettings={() => {}}
                  connecting={false}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {showConnectDialog && selectedProvider && (
        <ConnectIntegrationDialog
          provider={selectedProvider}
          open={showConnectDialog}
          onClose={() => {
            setShowConnectDialog(false);
            setSelectedProvider(null);
          }}
          onConnect={handleConnectComplete}
        />
      )}

      {showSettingsDialog && selectedIntegration && (
        <IntegrationSettingsDialog
          integration={selectedIntegration}
          open={showSettingsDialog}
          onClose={() => {
            setShowSettingsDialog(false);
            setSelectedIntegration(null);
          }}
          onSave={handleSettingsSave}
          onDisconnect={(ig) => {
            setShowSettingsDialog(false);
            setSelectedIntegration(null);
            handleDisconnect(ig);
          }}
        />
      )}
    </div>
  );
}

function DeploymentDefaultsTab({ settings, onSave }) {
  const [instanceType, setInstanceType] = useState(settings.default_instance_type || "starter");
  const [region, setRegion] = useState(settings.default_region || "fra1");
  const [autoDeploy, setAutoDeploy] = useState(settings.auto_deploy === "true");

  return (
    <div className="space-y-6">
      <SectionHeader icon={Server} title="Deployment Defaults" description="Default settings for new projects" />
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Default Instance Type</Label>
              <Select value={instanceType} onValueChange={(v) => { setInstanceType(v); onSave({ default_instance_type: v }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INSTANCE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div>
                        <p className="text-sm">{t.label}</p>
                        <p className="text-[10px] text-muted-foreground">{t.desc}</p>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Default Region</Label>
              <Select value={region} onValueChange={(v) => { setRegion(v); onSave({ default_region: v }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Auto-Deploy</p>
              <p className="text-xs text-muted-foreground">Automatically deploy when changes are pushed to the default branch</p>
            </div>
            <Switch checked={autoDeploy} onCheckedChange={(v) => { setAutoDeploy(v); onSave({ auto_deploy: String(v) }); }} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const SETTINGS_TABS = ["general", "appearance", "integrations", "deployment"];

function getActiveTab(pathname) {
  const last = pathname.split("/").filter(Boolean).pop();
  return SETTINGS_TABS.includes(last) ? last : "general";
}

export default function Settings() {
  const { settings, loading, saving, updateSettings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = getActiveTab(location.pathname);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-7 space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your application preferences</p>
        </div>
      </div>

      <div className="mt-7">
        <Tabs value={activeTab} onValueChange={(value) => navigate(`/settings/${value}`)}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="notifications" disabled>Notifications</TabsTrigger>
            <TabsTrigger value="api-keys" disabled>API Keys</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="deployment">Deployment</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-6 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Routes>
            <Route index element={<Navigate to="/settings/general" replace />} />
            <Route path="general" element={<GeneralTab settings={settings} saving={saving} onSave={updateSettings} />} />
            <Route path="appearance" element={<AppearanceTab settings={settings} onSave={updateSettings} />} />
            <Route path="integrations" element={<IntegrationsTab />} />
            <Route path="deployment" element={<DeploymentDefaultsTab settings={settings} onSave={updateSettings} />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
