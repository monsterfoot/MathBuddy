"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getMyStudents,
  removeStudent,
  type UserProfileResponse,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";

export default function StudentsListPage() {
  const t = useTranslations("parentStudents");
  const tc = useTranslations("common");
  const [students, setStudents] = useState<UserProfileResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);

  const loadStudents = () => {
    getMyStudents()
      .then((res) => setStudents(res.students))
      .catch(() => setStudents([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadStudents();
  }, []);

  const handleRemove = async (studentUid: string) => {
    if (!confirm(t("removeConfirm"))) return;
    setRemoving(studentUid);
    try {
      await removeStudent(studentUid);
      setStudents((prev) => prev.filter((s) => s.uid !== studentUid));
    } catch {
      alert(t("removeFailed"));
    } finally {
      setRemoving(null);
    }
  };

  if (loading) {
    return (
      <p className="py-10 text-center text-muted-foreground">{tc("loading")}</p>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("title")}</h3>
        <Button asChild variant="ghost" size="sm">
          <Link href="/parent">{tc("back")}</Link>
        </Button>
      </div>

      {students.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-muted-foreground">{t("noStudents")}</p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            {t("noStudentsHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {students.map((s) => (
            <div key={s.uid} className="flex items-center gap-2">
              <Link href={`/parent/students/${s.uid}`} className="flex-1">
                <Card className="transition-colors hover:bg-muted/50">
                  <CardContent className="flex items-center gap-3 p-4">
                    {s.photo_url ? (
                      <img
                        src={s.photo_url}
                        alt=""
                        className="h-10 w-10 rounded-full"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
                        {(s.display_name || s.email)[0]}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {s.display_name || tc("noName")}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.email}
                      </p>
                    </div>
                    <Badge variant={s.approved ? "default" : "secondary"}>
                      {s.approved ? tc("approved") : tc("pending")}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemove(s.uid)}
                disabled={removing === s.uid}
              >
                {removing === s.uid ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
