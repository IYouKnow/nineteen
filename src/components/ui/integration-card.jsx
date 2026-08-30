import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CheckCircle2, Settings, Loader2, FolderGit2 } from "lucide-react";

export function IntegrationCard({
  provider,
  integration,
  onConnect,
  onDisconnect,
  onSettings,
  connecting,
}) {
  const isConnected = !!integration;
  const isEnabled = provider.enabled !== false;
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  return (
    <div
      className={cn(
        "relative rounded-lg border p-4 transition-all",
        isConnected
          ? "border-border bg-card"
          : isEnabled
            ? "border-border bg-card hover:border-foreground/20"
            : "border-border/50 bg-muted/30 opacity-60"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg",
              isConnected ? "bg-foreground/10" : "bg-muted"
            )}
          >
            {provider.icon === "github" ? (
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            ) : (
              <span className="text-lg font-bold text-muted-foreground">
                {provider.name.charAt(0)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">
                {provider.name}
              </p>
              {isConnected && (
                <Badge
                  variant="secondary"
                  className="text-[10px] bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400"
                >
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Connected
                </Badge>
              )}
              {!isEnabled && (
                <Badge variant="secondary" className="text-[10px]">
                  Coming Soon
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {provider.description}
            </p>
            {isConnected && integration.username && (
              <div className="flex items-center gap-2 mt-2">
                <Avatar className="h-5 w-5">
                  <AvatarImage src={integration.avatar_url} />
                  <AvatarFallback className="text-[10px]">
                    {integration.username.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {integration.provider === "github" ? (
                  <a
                    href={`https://github.com/${integration.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {integration.label !== provider.name
                      ? `${integration.label} (${integration.username})`
                      : integration.username}
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {integration.label !== provider.name
                      ? `${integration.label} (${integration.username})`
                      : integration.username}
                  </span>
                )}
              </div>
            )}
            {isConnected && typeof integration.repo_count === "number" && integration.repo_count > 0 && (
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                <FolderGit2 className="h-3.5 w-3.5" />
                {integration.repo_count} repositor{integration.repo_count === 1 ? "y" : "ies"}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onSettings(integration)}
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDisconnectConfirm(true)}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              variant="white"
              size="sm"
              disabled={!isEnabled || connecting}
              onClick={() => onConnect(provider)}
            >
              {connecting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {isEnabled ? "Connect" : "Coming Soon"}
            </Button>
          )}
        </div>
      </div>

      {integration && (
        <AlertDialog
          open={showDisconnectConfirm}
          onOpenChange={setShowDisconnectConfirm}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect Integration?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the connection to {integration.username} on{" "}
                {integration.provider}. You can reconnect at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setShowDisconnectConfirm(false);
                  onDisconnect(integration);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
