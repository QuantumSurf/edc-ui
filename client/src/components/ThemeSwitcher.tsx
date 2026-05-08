import { useState, useRef, useEffect } from "react";
import { Palette, Check } from "lucide-react";
import { useTheme, THEMES, type AppTheme } from "@/contexts/ThemeContext";
import { useI18n } from "@/i18n";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
        title={t.settings.themeSelect}
      >
        <Palette className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-56 bg-popover border border-border rounded-lg shadow-xl z-50 p-2 space-y-1">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 pb-1">
            {t.settings.themeSelect}
          </p>
          {THEMES.map((def) => (
            <button
              key={def.id}
              onClick={() => { setTheme(def.id as AppTheme); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-2 py-2 rounded-md text-left transition-colors ${
                theme === def.id
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-accent/50"
              }`}
            >
              {/* Color preview swatch */}
              <span className="flex gap-0.5 shrink-0">
                <span
                  className="w-3 h-6 rounded-l-sm"
                  style={{ background: def.preview.sidebar }}
                />
                <span
                  className="w-5 h-6"
                  style={{ background: def.preview.bg }}
                />
                <span
                  className="w-2 h-6 rounded-r-sm"
                  style={{ background: def.preview.primary }}
                />
              </span>

              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-medium leading-tight">
                  {(t.settings as Record<string, string>)[def.nameKey]}
                </span>
                <span className="block text-[11px] text-muted-foreground leading-tight truncate">
                  {(t.settings as Record<string, string>)[def.descKey]}
                </span>
              </span>

              {theme === def.id && (
                <Check className="w-3.5 h-3.5 text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
