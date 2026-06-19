import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        style: {
          fontSize: "13px",
          padding: "14px 18px",
          borderRadius: "12px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)",
          gap: "10px",
          minWidth: "320px",
        },
        classNames: {
          success: "!bg-emerald-600 !text-white !border-emerald-700",
          error: "!bg-red-600 !text-white !border-red-700",
          warning: "!bg-amber-500 !text-white !border-amber-600",
          info: "!bg-blue-600 !text-white !border-blue-700",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
