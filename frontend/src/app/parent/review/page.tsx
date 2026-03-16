"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getAllReviewCards,
  deleteReviewCard,
  deleteAllReviewCards,
  getMyStudents,
  type MistakeCard,
  type UserProfileResponse,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { useConceptTagLabel } from "@/lib/i18n-labels";

function useFormatDueDate() {
  const tr = useTranslations("review");
  return (iso: string): string => {
    const due = new Date(iso);
    const now = new Date();
    const diffMs = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return tr("today");
    if (diffDays === 1) return tr("tomorrow");
    return tr("daysLater", { days: diffDays });
  };
}

export default function ParentReviewPage() {
  const t = useTranslations("parentReview");
  const tc = useTranslations("common");
  const tr = useTranslations("review");
  const conceptTagLabel = useConceptTagLabel();
  const formatDueDate = useFormatDueDate();
  const [students, setStudents] = useState<UserProfileResponse[]>([]);
  const [selectedStudentUid, setSelectedStudentUid] = useState<string | null>(null);
  const [studentsLoading, setStudentsLoading] = useState(true);

  const [cards, setCards] = useState<MistakeCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  // Load students on mount
  useEffect(() => {
    getMyStudents()
      .then((res) => {
        setStudents(res.students);
        if (res.students.length > 0) {
          setSelectedStudentUid(res.students[0].uid);
        }
      })
      .catch(() => setStudents([]))
      .finally(() => setStudentsLoading(false));
  }, []);

  // Load cards whenever selected student changes
  const loadCards = useCallback(() => {
    if (!selectedStudentUid) {
      setCards([]);
      return;
    }
    setLoading(true);
    getAllReviewCards(selectedStudentUid)
      .then((res) => setCards(res.cards))
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
  }, [selectedStudentUid]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const selectedStudent = students.find((s) => s.uid === selectedStudentUid);

  const handleDeleteOne = async (cardId: string) => {
    if (!confirm(t("deleteConfirm"))) return;
    setDeletingId(cardId);
    try {
      await deleteReviewCard(cardId);
      setCards((prev) => prev.filter((c) => c.card_id !== cardId));
    } catch {
      alert(t("deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!selectedStudentUid) return;
    if (!confirm(t("deleteAllConfirm", { count: cards.length })))
      return;
    setDeletingAll(true);
    try {
      await deleteAllReviewCards(selectedStudentUid);
      setCards([]);
    } catch {
      alert(t("deleteAllFailed"));
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t("title")}</h3>
          {selectedStudent && (
            <p className="text-sm text-muted-foreground">
              {selectedStudent.display_name || selectedStudent.email}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {cards.length > 0 && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleDeleteAll}
              disabled={deletingAll}
            >
              {deletingAll ? tc("deleting") : t("deleteAll")}
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link href="/parent">{tc("goBack")}</Link>
          </Button>
        </div>
      </div>

      {/* Student selector */}
      {studentsLoading ? (
        <p className="text-sm text-muted-foreground">{t("loadingStudents")}</p>
      ) : students.length === 0 ? (
        <div className="rounded-lg bg-gray-50 p-4 text-center">
          <p className="text-sm text-muted-foreground">{t("noStudents")}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {t("noStudentsHint")}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {students.map((s) => (
            <button
              key={s.uid}
              onClick={() => setSelectedStudentUid(s.uid)}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                selectedStudentUid === s.uid
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {s.display_name || s.email}
            </button>
          ))}
        </div>
      )}

      {/* Cards list */}
      {!selectedStudentUid ? null : loading ? (
        <p className="py-10 text-center text-muted-foreground">{tc("loading")}</p>
      ) : cards.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-muted-foreground">{t("noCards")}</p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            {t("noCardsHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("totalCards")}{cards.length}
          </p>
          {cards.map((card) => {
            const isDue = new Date(card.due_at) <= new Date();
            return (
              <Card key={card.card_id}>
                <CardContent className="flex items-start justify-between gap-2 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">
                        {conceptTagLabel(card.concept_tag)}
                      </p>
                      {isDue && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          {tr("reviewNeeded")}
                        </Badge>
                      )}
                    </div>
                    {card.workbook_id && card.page != null && card.number != null && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {tc("pageNumber", { page: card.page, number: card.number })}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {card.repetitions}{tr("nextDue")}{formatDueDate(card.due_at)}
                    </p>
                    {card.problem_description && (
                      <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">
                        {card.problem_description}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive shrink-0"
                    onClick={() => handleDeleteOne(card.card_id)}
                    disabled={deletingId === card.card_id}
                  >
                    {deletingId === card.card_id ? "..." : tc("delete")}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
