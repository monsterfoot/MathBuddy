"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listAllRegenRequests,
  resolveRegenRequest,
  deleteRegenRequest,
  type RegenRequest,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MathText } from "@/components/MathText";
import { useTranslations } from "next-intl";

type TabStatus = "pending" | "accepted" | "rejected";

export default function RegenRequestsPage() {
  const router = useRouter();
  const tr = useTranslations("regenRequests");
  const tc = useTranslations("common");
  const [requests, setRequests] = useState<RegenRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabStatus>("pending");
  const [resolving, setResolving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadRequests = (status: TabStatus) => {
    setLoading(true);
    listAllRegenRequests(status)
      .then((res) => setRequests(res.requests))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRequests(tab);
  }, [tab]);

  const handleResolve = async (requestId: string, accepted: boolean) => {
    setResolving(requestId);
    try {
      await resolveRegenRequest(requestId, accepted);
      setRequests((prev) => prev.filter((r) => r.request_id !== requestId));
    } catch {
      // silently fail
    }
    setResolving(null);
  };

  const handleDelete = async (requestId: string) => {
    setDeleting(requestId);
    try {
      await deleteRegenRequest(requestId);
      setRequests((prev) => prev.filter((r) => r.request_id !== requestId));
    } catch {
      // silently fail
    }
    setDeleting(null);
  };

  const tabs: { key: TabStatus; label: string }[] = [
    { key: "pending", label: tr("pendingStatus") },
    { key: "accepted", label: tr("acceptedStatus") },
    { key: "rejected", label: tr("rejectedStatus") },
  ];

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="mx-auto max-w-sm space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{tr("title")}</h3>
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
      ) : requests.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">
          {tab === "pending"
            ? tr("noPending")
            : tr("noResolved")}
        </p>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <Card key={r.request_id} className="border-gray-200">
              <CardContent className="space-y-3 p-4">
                {/* Header: workbook + problem */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {r.workbook_label || r.workbook_id}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tc("pageNumber", { page: r.page, number: r.number })}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {tab === "pending" && (
                      <Badge
                        variant="secondary"
                        className="bg-purple-100 text-purple-700 text-xs"
                      >
                        {tc("pending")}
                      </Badge>
                    )}
                    {tab === "accepted" && (
                      <Badge
                        variant="secondary"
                        className="bg-green-100 text-green-700 text-xs"
                      >
                        {tc("approved")}
                      </Badge>
                    )}
                    {tab === "rejected" && (
                      <Badge
                        variant="secondary"
                        className="bg-red-100 text-red-700 text-xs"
                      >
                        {tr("rejectedStatus")}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Original problem description */}
                {r.problem_description && (
                  <div className="rounded-lg bg-gray-50 p-2.5">
                    <p className="mb-1 text-xs font-medium text-gray-500">
                      {tr("originalProblem")}
                    </p>
                    <MathText
                      as="p"
                      className="text-sm leading-relaxed"
                    >
                      {r.problem_description}
                    </MathText>
                  </div>
                )}

                {/* Generated variant (the bad one) */}
                <div className="rounded-lg bg-purple-50 p-2.5">
                  <p className="mb-1 text-xs font-medium text-purple-500">
                    {tr("generatedVariant")}
                  </p>
                  <MathText
                    as="p"
                    className="text-sm leading-relaxed"
                  >
                    {r.variant_text}
                  </MathText>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tc("correctAnswer")} <span className="font-mono font-semibold">{r.correct_answer}</span>
                  </p>
                </div>

                {/* Date + admin note */}
                <div className="text-xs text-muted-foreground">
                  {r.created_at && (
                    <p>{tc("submitted")}{formatDate(r.created_at)}</p>
                  )}
                  {r.resolved_at && (
                    <p>{tc("resolved")}{formatDate(r.resolved_at)}</p>
                  )}
                  {r.admin_note && (
                    <p className="mt-1 text-foreground">
                      {tc("adminNote")}{r.admin_note}
                    </p>
                  )}
                </div>

                {/* Action buttons for pending */}
                {tab === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resolving === r.request_id}
                      onClick={() => handleResolve(r.request_id, true)}
                      className="flex-1 text-xs text-green-600"
                    >
                      {tr("approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resolving === r.request_id}
                      onClick={() => handleResolve(r.request_id, false)}
                      className="flex-1 text-xs text-red-600"
                    >
                      {tr("reject")}
                    </Button>
                  </div>
                )}

                {/* Delete button for resolved requests */}
                {tab !== "pending" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={deleting === r.request_id}
                    onClick={() => handleDelete(r.request_id)}
                    className="w-full text-xs text-red-500 hover:text-red-600"
                  >
                    {deleting === r.request_id ? tc("deleting") : tc("delete")}
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
