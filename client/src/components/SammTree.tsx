// SAMM Aspect 구조를 접이식 트리로 표시한다. (JsonTreeView 패턴 미러링, 테마 토큰)
import { useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { Badge } from "@/components/ui-kmx";
import { useI18n } from "@/i18n";
import type { SammAspect, SammNode } from "@/lib/samm";

function Row({ node, depth }: { node: SammNode; depth: number }) {
  const hasChildren = !!node.children?.length;
  const [open, setOpen] = useState(depth < 2);
  const { t } = useI18n();
  return (
    <div>
      <div
        className="flex items-start gap-1.5 py-1 rounded hover:bg-muted/40"
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-0.5 flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={open ? t.common.collapse : t.common.expand}
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-foreground">{node.name}</span>
            {node.optional && <Badge variant="gray">optional</Badge>}
            {node.collection && <Badge variant="purple">{node.collection}</Badge>}
            {node.characteristic && (
              <span className="text-[11px] text-muted-foreground">{node.characteristic}</span>
            )}
            {node.dataType && (
              <span className="text-[11px] text-muted-foreground/70">: {node.dataType}</span>
            )}
          </div>
          {node.preferredName && (
            <div className="text-[11px] text-muted-foreground">{node.preferredName}</div>
          )}
          {node.enumValues?.length ? (
            <div className="text-[10px] text-muted-foreground break-all">
              {node.enumValues.join(" · ")}
            </div>
          ) : null}
        </div>
      </div>
      {hasChildren && open && node.children!.map((c, i) => (
        <Row key={`${c.name}-${i}`} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

export function SammTree({ aspect }: { aspect: SammAspect }) {
  return (
    <div className="text-xs">
      <div className="flex items-center gap-1.5 mb-2">
        <Layers className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-foreground break-all">{aspect.name}</span>
        {aspect.preferredName && (
          <span className="text-[11px] text-muted-foreground">{aspect.preferredName}</span>
        )}
      </div>
      <div className="rounded-lg border border-border bg-muted/20 p-2 max-h-[40vh] overflow-auto">
        {aspect.children?.length ? (
          aspect.children.map((c, i) => <Row key={`${c.name}-${i}`} node={c} depth={0} />)
        ) : (
          <div className="py-2 text-center text-[11px] text-muted-foreground italic">—</div>
        )}
      </div>
    </div>
  );
}
