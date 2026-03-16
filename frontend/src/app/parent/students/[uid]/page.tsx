"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getStudentWorkbookProgress,
  getStudentReviewStats,
  getStudentRecentActivity,
  type WorkbookProgress,
  type StudentReviewStats,
  type RecentAttempt,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTranslations } from "next-intl";
import { useConceptTagLabel, useErrorTagLabel } from "@/lib/i18n-labels";

export default function StudentDetailPage() {
  const params = useParams();
  const studentUid = params.uid as string;
  const t = useTranslations("parentStudentDetail");
  const tc = useTranslations("common");
  const conceptTagLabel = useConceptTagLabel();
  const errorTagLabel = useErrorTagLabel();

  const [workbooks, setWorkbooks] = useState<WorkbookProgress[]>([]);
  const [reviewStats, setReviewStats] = useState<StudentReviewStats | null>(null);
  const [attempts, setAttempts] = useState<RecentAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!studentUid) return;

    Promise.all([
      getStudentWorkbookProgress(studentUid),
      getStudentReviewStats(studentUid),
      getStudentRecentActivity(studentUid),
    ])
      .then(([wb, review, activity]) => {
        setWorkbooks(wb.workbooks);
        setReviewStats(review);
        setAttempts(activity.attempts);
      })
      .catch(() => setError(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [studentUid]);

  if (loading) {
    return (
      <p className="py-10 text-center text-muted-foreground">{tc("loading")}</p>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <p className="py-10 text-center text-sm text-red-500">{error}</p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/parent/students">{tc("goBack")}</Link>
        </Button>
      </div>
    );
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = d.getHours().toString().padStart(2, "0");
    const mins = d.getMinutes().toString().padStart(2, "0");
    return `${month}/${day} ${hours}:${mins}`;
  };

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/parent/students">{tc("back")}</Link>
        </Button>
        <h3 className="text-lg font-semibold">{t("title")}</h3>
      </div>

      {/* Review stats */}
      {reviewStats && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              {t("reviewStatus")}
            </p>
            <div className="flex gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold">{reviewStats.total_cards}</p>
                <p className="text-xs text-muted-foreground">{t("totalCards")}</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-orange-600">
                  {reviewStats.due_cards}
                </p>
                <p className="text-xs text-muted-foreground">{t("todayReview")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Workbook progress */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          {t("workbookProgress")}
        </p>
        {workbooks.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("noRecords")}
          </p>
        ) : (
          workbooks.map((wb) => {
            const pct =
              wb.total > 0
                ? Math.round(((wb.correct + wb.mastered) / wb.total) * 100)
                : 0;
            return (
              <Card key={wb.workbook_id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{wb.label}</p>
                    <Badge variant="outline" className="text-xs">
                      {pct}%
                    </Badge>
                  </div>
                  <Progress value={pct} className="mt-2 h-2" />
                  <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground">
                    <span>
                      {t("correctCount")}
                      <span className="font-medium text-green-700">
                        {wb.correct}
                      </span>
                    </span>
                    <span>
                      {t("wrongCount")}
                      <span className="font-medium text-red-700">
                        {wb.wrong}
                      </span>
                    </span>
                    <span>
                      {t("masteredCount")}
                      <span className="font-medium text-blue-700">
                        {wb.mastered}
                      </span>
                    </span>
                    <span className="ml-auto">
                      {t("totalCount")}{wb.total}{tc("problem")}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Recent activity */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          {t("recentActivity")}
        </p>
        {attempts.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("noActivity")}
          </p>
        ) : (
          <div className="space-y-1.5">
            {attempts.map((a) => (
              <div
                key={a.attempt_id}
                className="flex items-center gap-2 rounded-lg border px-3 py-2"
              >
                <span
                  className={`text-sm ${
                    a.is_correct ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {a.is_correct ? "O" : "X"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">
                    {tc("pageNumber", { page: a.page, number: a.number })}
                    {a.concept_tag && (
                      <span className="ml-1.5 text-muted-foreground">
                        {conceptTagLabel(a.concept_tag)}
                      </span>
                    )}
                  </p>
                  {!a.is_correct && a.error_tag && a.error_tag !== "none" && (
                    <p className="text-xs text-red-500">
                      {errorTagLabel(a.error_tag)}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {a.created_at ? formatDate(a.created_at) : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
