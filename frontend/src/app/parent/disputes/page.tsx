"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listAllDisputes,
  resolveDispute,
  deleteDispute,
  type Dispute,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MathText } from "@/components/MathText";
import { useTranslations } from "next-intl";
import { useDisputeSourceLabel } from "@/lib/i18n-labels";

type TabStatus = "pending" | "accepted" | "rejected";

export default function DisputesPage() {
  const router = useRouter();
  const td = useTranslations("disputes");
  const tc = useTranslations("common");
  const disputeSourceLabel = useDisputeSourceLabel();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabStatus>("pending");
  const [resolving, setResolving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadDisputes = (status: TabStatus) => {
    setLoading(true);
    listAllDisputes(status)
      .then((res) => setDisputes(res.disputes))
      .catch(() => setDisputes([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDisputes(tab);
  }, [tab]);

  const handleResolve = async (disputeId: string, accepted: boolean) => {
    setResolving(disputeId);
    try {
      await resolveDispute(disputeId, accepted);
      setDisputes((prev) => prev.filter((d) => d.dispute_id !== disputeId));
    } catch {
      // silently fail
    }
    setResolving(null);
  };

  const handleDelete = async (disputeId: string) => {
    setDeleting(disputeId);
    try {
      await deleteDispute(disputeId);
      setDisputes((prev) => prev.filter((d) => d.dispute_id !== disputeId));
    } catch {
      // silently fail
    }
    setDeleting(null);
  };

  const tabs: { key: TabStatus; label: string }[] = [
    { key: "pending", label: td("pendingStatus") },
    { key: "accepted", label: td("acceptedStatus") },
    { key: "rejected", label: td("rejectedStatus") },
  ];

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="mx-auto max-w-sm space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{td("title")}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/parent")}
        >
          {tc("back")}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabStatus)}>
        <TabsList className="w-full">
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="flex-1">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <p className="py-10 text-center text-muted-foreground">
          {tc("loading")}
        </p>
      ) : disputes.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">
          {tab === "pending"
            ? td("noPending")
            : td("noResolved")}
        </p>
      ) : (
        <div className="space-y-3">
          {disputes.map((d) => (
            <Card key={d.dispute_id} className="border-gray-200">
              <CardContent className="space-y-3 p-4">
                {/* Header: workbook + problem + source */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {d.workbook_label || d.workbook_id}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tc("pageNumber", { page: d.page, number: d.number })}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Badge variant="outline" className="text-xs">
                      {disputeSourceLabel(d.source || "solve")}
                    </Badge>
                    {tab === "pending" && (
                      <Badge
                        variant="secondary"
                        className="bg-orange-100 text-orange-700 text-xs"
                      >
                        {tc("pending")}
                      </Badge>
                    )}
                    {tab === "accepted" && (
                      <Badge
                        variant="secondary"
                        className="bg-green-100 text-green-700 text-xs"
                      >
                        {td("acceptedStatus")}
                      </Badge>
                    )}
                    {tab === "rejected" && (
                      <Badge
                        variant="secondary"
                        className="bg-red-100 text-red-700 text-xs"
                      >
                        {td("rejectedStatus")}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Problem description */}
                {d.problem_description && (
                  <div className="rounded-lg bg-gray-50 p-2.5">
                    <p className="mb-1 text-xs font-medium text-gray-500">
                      {d.source === "verify"
                        ? td("verifyContent")
                        : d.source === "review"
                          ? td("reviewContent")
                          : td("problemContent")}
                    </p>
                    <MathText
                      as="p"
                      className="text-sm leading-relaxed"
                    >
                      {d.problem_description}
                    </MathText>
                  </div>
                )}

                {/* Answers */}
                <div className="space-y-1 text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {tc("studentAnswer")}
                    </span>
                    <span className="font-mono font-semibold">
                      {d.student_answer || "—"}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {tc("correctAnswer")}
                    </span>
                    <span className="font-mono font-semibold">
                      {d.correct_answer || "—"}
                    </span>
                  </div>
                </div>

                {/* Date + admin note */}
                <div className="text-xs text-muted-foreground">
                  {d.created_at && (
                    <p>{tc("submitted")}{formatDate(d.created_at)}</p>
                  )}
                  {d.resolved_at && (
                    <p>{tc("resolved")}{formatDate(d.resolved_at)}</p>
                  )}
                  {d.admin_note && (
                    <p className="mt-1 text-foreground">
                      {tc("adminNote")}{d.admin_note}
                    </p>
                  )}
                </div>

                {/* Action buttons for pending */}
                {tab === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resolving === d.dispute_id}
                      onClick={() => handleResolve(d.dispute_id, true)}
                      className="flex-1 text-xs text-green-600"
                    >
                      {td("accept")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resolving === d.dispute_id}
                      onClick={() => handleResolve(d.dispute_id, false)}
                      className="flex-1 text-xs text-red-600"
                    >
                      {td("reject")}
                    </Button>
                  </div>
                )}

                {/* Delete button for resolved disputes */}
                {tab !== "pending" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={deleting === d.dispute_id}
                    onClick={() => handleDelete(d.dispute_id)}
                    className="w-full text-xs text-red-500 hover:text-red-600"
                  >
                    {deleting === d.dispute_id ? tc("deleting") : tc("delete")}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
