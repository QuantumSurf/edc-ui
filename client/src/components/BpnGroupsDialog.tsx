// KMX EDC — BPN Group Management Dialog
// kmx-bpn-policy 확장의 /v3/business-partner-groups 관리 API 를 소비한다.
// BusinessPartnerGroup 정책 제약(isAnyOf 등)은 여기 등록된 BPN→그룹 매핑으로 평가되며,
// 미등록 BPN 은 그룹 정책에서 항상 거부되므로 정책 화면에서 함께 관리한다.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchBpnGroups,
  saveBpnGroupEntry,
  deleteBpnGroupEntry,
} from "@/services/api";
import { RoleGate } from "@/components/RoleGate";
import { Badge } from "@/components/ui-kmx";
import { toast } from "sonner";
import { Loader2, Trash2, Users, Plus } from "lucide-react";

const BPN_RE = /^BPNL[0-9A-Z]{12}$/;

const inputBase =
  "w-full text-[12px] px-2.5 py-1.5 rounded-md border border-border bg-background focus:outline-none focus:border-primary transition-colors";

export function BpnGroupsDialog({
  connectorId,
  open,
  onClose,
}: {
  connectorId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [bpn, setBpn] = useState("");
  const [groupsInput, setGroupsInput] = useState("");

  const {
    data: groups = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["bpn-groups", connectorId],
    queryFn: () => fetchBpnGroups(connectorId),
    enabled: open && !!connectorId,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["bpn-groups", connectorId] });

  const saveMut = useMutation({
    mutationFn: () =>
      saveBpnGroupEntry(
        connectorId,
        bpn.trim(),
        groupsInput
          .split(",")
          .map(s => s.trim())
          .filter(Boolean)
      ),
    onSuccess: () => {
      toast.success(t.policies.bpnGroups.saved);
      setBpn("");
      setGroupsInput("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (target: string) => deleteBpnGroupEntry(connectorId, target),
    onSuccess: () => {
      toast.success(t.policies.bpnGroups.deleted);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bpnValid = BPN_RE.test(bpn.trim());
  const groupsValid = groupsInput.split(",").some(s => s.trim().length > 0);

  const handleSave = () => {
    if (!bpnValid) {
      toast.error(t.policies.bpnGroups.bpnInvalid);
      return;
    }
    if (!groupsValid) {
      toast.error(t.policies.bpnGroups.groupsRequired);
      return;
    }
    saveMut.mutate();
  };

  // 그룹 뷰(group→bpns)를 BPN 뷰(bpn→groups)로 뒤집어 행 단위 삭제/편집 대상으로 쓴다.
  const byBpn = new Map<string, string[]>();
  for (const g of groups) {
    for (const b of g.bpns) {
      byBpn.set(b, [...(byBpn.get(b) ?? []), g.group]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <DialogHeader className="border-b-0 pb-0">
            <DialogTitle className="font-display text-[15px] text-foreground font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              {t.policies.bpnGroups.title}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground mt-1">
              {t.policies.bpnGroups.subtitle}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-4">
          <p className="text-[11px] text-muted-foreground">
            {t.policies.bpnGroups.hint}
          </p>

          {/* 매핑 목록 */}
          {isLoading ? (
            <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[12px]">{t.common.loading}</span>
            </div>
          ) : isError || byBpn.size === 0 ? (
            <div className="py-6 text-center text-[12px] text-muted-foreground">
              {t.policies.bpnGroups.empty}
            </div>
          ) : (
            <div className="border border-border rounded-lg divide-y divide-border">
              {[...byBpn.entries()].map(([b, gs]) => (
                <div
                  key={b}
                  className="flex items-center gap-2 px-3 py-2 text-[12px]"
                >
                  <span className="mono font-medium text-foreground flex-shrink-0">
                    {b}
                  </span>
                  <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
                    {gs.map(g => (
                      <Badge key={g} variant="blue">
                        {g}
                      </Badge>
                    ))}
                  </div>
                  <RoleGate permission="resource:write">
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => {
                          setBpn(b);
                          setGroupsInput(gs.join(", "));
                        }}
                        className="text-[11px] px-2 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        {t.common.edit}
                      </button>
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              t.policies.bpnGroups.deleteConfirm(b)
                            )
                          ) {
                            deleteMut.mutate(b);
                          }
                        }}
                        aria-label={`${t.common.delete} ${b}`}
                        className="p-1 rounded text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </RoleGate>
                </div>
              ))}
            </div>
          )}

          {/* 추가/수정 폼 */}
          <RoleGate permission="resource:write">
            <div className="border border-border rounded-lg p-3 space-y-2.5 bg-muted/20">
              <div className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-wider">
                {t.policies.bpnGroups.addTitle}
              </div>
              <div>
                <label
                  htmlFor="bpn-group-bpn"
                  className="block text-[11px] font-medium text-muted-foreground mb-1"
                >
                  {t.policies.bpnGroups.bpnLabel}
                </label>
                <input
                  id="bpn-group-bpn"
                  value={bpn}
                  onChange={e => setBpn(e.target.value.toUpperCase())}
                  placeholder="BPNL000000000CON"
                  className={`${inputBase} mono`}
                />
                {bpn.trim() !== "" && !bpnValid && (
                  <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                    {t.policies.bpnGroups.bpnInvalid}
                  </div>
                )}
              </div>
              <div>
                <label
                  htmlFor="bpn-group-groups"
                  className="block text-[11px] font-medium text-muted-foreground mb-1"
                >
                  {t.policies.bpnGroups.groupsLabel}
                </label>
                <input
                  id="bpn-group-groups"
                  value={groupsInput}
                  onChange={e => setGroupsInput(e.target.value)}
                  placeholder={t.policies.bpnGroups.groupsPlaceholder}
                  className={`${inputBase} mono`}
                />
              </div>
              <button
                onClick={handleSave}
                disabled={saveMut.isPending}
                className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-medium transition-colors"
              >
                {saveMut.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                {t.policies.bpnGroups.save}
              </button>
            </div>
          </RoleGate>
        </div>

        <div className="flex items-center justify-end px-6 py-3 bg-muted/30 border-t border-border">
          <button
            onClick={onClose}
            className="text-[12px] px-4 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground font-medium"
          >
            {t.common.close}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
