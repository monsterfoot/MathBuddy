"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { listWorkbooks, leaveTeacher, type Workbook } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Globe, GraduationCap, Loader2, LogOut, Search } from "lucide-react";

const PAGE_SIZE = 5;

export default function TeacherWorkbooksPage() {
  const params = useParams();
  const router = useRouter();
  const teacherUid = params.teacherUid as string;
  const isSolo = teacherUid === "solo";

  const [workbooks, setWorkbooks] = useState<Workbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const setWorkbookId = useAppStore((s) => s.setWorkbookId);
  const setIsSoloStudy = useAppStore((s) => s.setIsSoloStudy);
  const teacherLinks = useAppStore((s) => s.teacherLinks);

  const t = useTranslations("teacherWorkbooks");
  const tStudentHome = useTranslations("studentHome");
  const tCommon = useTranslations("common");

  // Search & pagination
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Find teacher info from store
  const teacher = teacherLinks.find((l) => l.teacher_uid === teacherUid);
  const teacherName = teacher?.teacher_display_name || teacher?.teacher_email || "";

  const idToken = useAppStore((s) => s.idToken);

  useEffect(() => {
    setLoading(true);
    listWorkbooks(teacherUid)
      .then((wbs) => setWorkbooks(wbs.filter((w) => w.status === "locked")))
      .catch(() => setWorkbooks([]))
      .finally(() => setLoading(false));
    // idToken in deps: re-run when token becomes available after mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherUid, idToken]);

  const filtered = useMemo(() => {
    if (!search.trim()) return workbooks;
    const q = search.trim().toLowerCase();
    return workbooks.filter((wb) => wb.label.toLowerCase().includes(q));
  }, [workbooks, search]);

  useEffect(() => { setPage(1); }, [search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleLeave = async () => {
    if (!confirm(t("leaveConfirm"))) return;
    setLeaving(true);
    try {
      await leaveTeacher(teacherUid);
      router.push("/student");
    } catch {
      setLeaving(false);
    }
  };

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/student">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            {isSolo ? (
              <Globe className="h-5 w-5 text-green-600" />
            ) : (
              <GraduationCap className="h-5 w-5 text-primary" />
            )}
            <h3 className="text-lg font-semibold">
              {isSolo ? t("publicTitle") : t("title", { name: teacherName })}
            </h3>
          </div>
        </div>
        {!isSolo && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleLeave}
            disabled={leaving}
          >
            {leaving ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <LogOut className="mr-1 h-3 w-3" />
            )}
            {t("leave")}
          </Button>
        )}
      </div>

      {/* Search */}
      {!loading && workbooks.length > 0 && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchWorkbook")}
            className="pl-9 h-9 text-sm"
          />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">{tCommon("loading")}</p>
        </div>
      ) : workbooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <p className="text-lg font-medium text-muted-foreground">
            {t("noWorkbooks")}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("noSearchResults")}</p>
      ) : (
        <>
          <div className="grid gap-3">
            {slice.map((wb) => (
              <Link
                key={wb.workbook_id}
                href="/student/solve"
                onClick={() => {
                  setWorkbookId(wb.workbook_id);
                  setIsSoloStudy(isSolo);
                }}
              >
                <Card className="transition-colors active:bg-muted">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-xl">
                      📘
                    </div>
                    <div>
                      <p className="font-medium">{wb.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {wb.answer_coverage}{tStudentHome("problemCount")}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {tCommon("prev")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                {tCommon("next")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
