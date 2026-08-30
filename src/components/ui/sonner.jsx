import { useTheme } from "@/lib/theme";
import { Toaster as Sonner } from "sonner";

function Toaster({ ...props }) {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      duration={5000}
      toastOptions={{
        className: "rounded-lg border border-border bg-card p-4 shadow-lg",
        classNames: {
          success: "border-l-4 border-l-success",
          error: "border-l-4 border-l-destructive",
          warning: "border-l-4 border-l-warning",
          info: "border-l-4 border-l-info",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
