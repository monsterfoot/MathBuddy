"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getMyTeachers, joinTeacher, leaveTeacher, type TeacherLink } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { useAuth } from "@/components/AuthProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, GraduationCap, Loader2, Plus, Search, Trash2, X } from "lucide-react";

const PAGE_SIZE = 5;

export default function StudentHome() {
  const [teachers, setTeachers] = useState<TeacherLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddTeacher, setShowAddTeacher] = useState(false);
  const [teacherEmail, setTeacherEmail] = useState("");
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setTeacherLinks = useAppStore((s) => s.setTeacherLinks);
  const { idToken } = useAuth();
  const t = useTranslations("studentHome");
  const tCommon = useTranslations("common");

  // Search & pagination
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const loadTeachers = async () => {
    try {
      const result = await getMyTeachers();
      setTeachers(result);
      setTeacherLinks(result);
    } catch {
      setTeachers([]);
      setTeacherLinks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (idToken) {
      loadTeachers();
    }
  }, [idToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoin = async () => {
    if (!teacherEmail.trim()) return;
    setJoining(true);
    setError(null);
    try {
      await joinTeacher(teacherEmail.trim());
      setTeacherEmail("");
      setShowAddTeacher(false);
      await loadTeachers();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("joinFailed"));
    } finally {
      setJoining(false);
    }
  };

  const handleLeave = async (teacherUid: string) => {
    if (!confirm(t("leaveConfirm"))) return;
    setLeaving(teacherUid);
    try {
      await leaveTeacher(teacherUid);
      await loadTeachers();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("leaveFailed"));
    } finally {
      setLeaving(null);
    }
  };

  // Filter teachers by search
  const filtered = useMemo(() => {
    if (!search.trim()) return teachers;
    const q = search.trim().toLowerCase();
    return teachers.filter(
      (t) =>
        (t.teacher_display_name || "").toLowerCase().includes(q) ||
        (t.teacher_email || "").toLowerCase().includes(q)
    );
  }, [teachers, search]);

  useEffect(() => { setPage(1); }, [search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">{tCommon("loading")}</p>
      </div>
    );
  }

  return (
    <div className="pb-20">
      <h3 className="mb-4 text-lg font-semibold">{t("myTeachers")}</h3>

      {/* Search — only show if 3+ teachers */}
      {teachers.length >= 3 && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchTeacher")}
            className="pl-9 h-9 text-sm"
          />
        </div>
      )}

      <div className="grid gap-3">
        {/* Teacher cards */}
        {slice.map((teacher) => (
          <div key={teacher.teacher_uid} className="flex items-center gap-2">
            <Link
              href={`/student/teacher/${teacher.teacher_uid}`}
              className="flex-1"
            >
              <Card className="transition-colors active:bg-muted">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                    <GraduationCap className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {teacher.teacher_display_name || teacher.teacher_email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {teacher.teacher_email}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => handleLeave(teacher.teacher_uid)}
              disabled={leaving === teacher.teacher_uid}
            >
              {leaving === teacher.teacher_uid ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        ))}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
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

        {/* Public workbooks card — always visible */}
        <Link href="/student/teacher/solo">
          <Card className="transition-colors active:bg-muted">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/10">
                <Globe className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="font-medium">{t("publicWorkbooks")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("soloMode")}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Add teacher */}
        {!showAddTeacher ? (
          <Button
            variant="outline"
            className="h-14 border-dashed"
            onClick={() => setShowAddTeacher(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("addTeacher")}
          </Button>
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{t("teacherEmail")}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    setShowAddTeacher(false);
                    setTeacherEmail("");
                    setError(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="teacher@gmail.com"
                  value={teacherEmail}
                  onChange={(e) => setTeacherEmail(e.target.value)}
                  disabled={joining}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                />
                <Button
                  onClick={handleJoin}
                  disabled={joining || !teacherEmail.trim()}
                >
                  {joining ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("join")
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {error && (
        <p className="mt-3 text-center text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
