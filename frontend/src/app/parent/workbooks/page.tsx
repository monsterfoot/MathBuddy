"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listWorkbooks, forkWorkbook, type Workbook } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, Search } from "lucide-react";

const PAGE_SIZE = 5;

export default function WorkbooksListPage() {
  const t = useTranslations("parent");
  const tVis = useTranslations("visibility");
  const tc = useTranslations("common");
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const [workbooks, setWorkbooks] = useState<Workbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [forking, setForking] = useState<string | null>(null);

  // Search
  const [search, setSearch] = useState("");

  // Collapse
  const [myExpanded, setMyExpanded] = useState(true);
  const [sharedExpanded, setSharedExpanded] = useState(false);

  // Pagination
  const [myPage, setMyPage] = useState(1);
  const [sharedPage, setSharedPage] = useState(1);

  useEffect(() => {
    listWorkbooks()
      .then(setWorkbooks)
      .catch(() => setWorkbooks([]))
      .finally(() => setLoading(false));
  }, []);

  const myUid = firebaseUser?.uid;

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return workbooks;
    const q = search.trim().toLowerCase();
    return workbooks.filter((wb) => wb.label.toLowerCase().includes(q));
  }, [workbooks, search]);

  const myWorkbooks = filtered.filter((wb) => wb.owner_uid === myUid);
  const sharedWorkbooks = filtered.filter((wb) => wb.owner_uid !== myUid);

  // Reset pages when search changes
  useEffect(() => {
    setMyPage(1);
    setSharedPage(1);
  }, [search]);

  // Paginate
  const myTotal = Math.ceil(myWorkbooks.length / PAGE_SIZE);
  const mySlice = myWorkbooks.slice((myPage - 1) * PAGE_SIZE, myPage * PAGE_SIZE);
  const sharedTotal = Math.ceil(sharedWorkbooks.length / PAGE_SIZE);
  const sharedSlice = sharedWorkbooks.slice((sharedPage - 1) * PAGE_SIZE, sharedPage * PAGE_SIZE);

  const handleFork = async (wb: Workbook) => {
    if (!confirm(t("forkConfirm", { label: wb.label }))) return;
    setForking(wb.workbook_id);
    try {
      const forked = await forkWorkbook(wb.workbook_id);
      router.push(`/parent/workbook/${forked.workbook_id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : t("forkFailed"));
    } finally {
      setForking(null);
    }
  };

  const WorkbookCard = ({ wb, showFork }: { wb: Workbook; showFork?: boolean }) => (
    <Card className="transition-colors hover:bg-muted/50">
      <CardContent className="flex items-center justify-between p-4">
        <Link href={`/parent/workbook/${wb.workbook_id}`} className="flex-1 min-w-0">
          <p className="font-medium truncate">{wb.label}</p>
          <p className="text-xs text-muted-foreground">
            {wb.status === "locked" ? t("registered") : t("draft")} ·{" "}
            {wb.answer_coverage}/{wb.problem_count || "?"} {tc("problem")}
          </p>
        </Link>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {showFork && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px]"
              disabled={forking === wb.workbook_id}
              onClick={(e) => {
                e.preventDefault();
                handleFork(wb);
              }}
            >
              {forking === wb.workbook_id ? tc("processing") : t("forkButton")}
            </Button>
          )}
          <Badge variant="outline" className="text-[10px]">
            {tVis(wb.visibility || "public")}
          </Badge>
          <Badge
            variant={wb.status === "locked" ? "default" : "secondary"}
          >
            {wb.status === "locked" ? t("locked") : t("draftStatus")}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );

  const Pagination = ({
    current,
    total,
    onChange,
  }: {
    current: number;
    total: number;
    onChange: (p: number) => void;
  }) => {
    if (total <= 1) return null;
    return (
      <div className="flex items-center justify-center gap-2 pt-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          disabled={current <= 1}
          onClick={() => onChange(current - 1)}
        >
          {tc("prev")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {current} / {total}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          disabled={current >= total}
          onClick={() => onChange(current + 1)}
        >
          {tc("next")}
        </Button>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("workbookManagement")}</h3>
        <div className="flex items-center gap-2">
          <Button asChild size="sm">
            <Link href="/parent/scan">{t("newWorkbook")}</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/parent">{tc("back")}</Link>
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchWorkbook")}
          className="pl-9 h-9 text-sm"
        />
      </div>

      {loading ? (
        <p className="py-10 text-center text-muted-foreground">{tc("loading")}</p>
      ) : workbooks.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-muted-foreground">{t("noWorkbooks")}</p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            {t("addWorkbookPrompt")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 내 교재 */}
          <div>
            <button
              onClick={() => setMyExpanded(!myExpanded)}
              className="flex w-full items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-left transition-colors hover:bg-gray-100"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{t("myWorkbooks")}</span>
                <Badge variant="secondary" className="text-[10px]">{myWorkbooks.length}</Badge>
              </div>
              {myExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {myExpanded && (
              <div className="mt-2 space-y-2">
                {myWorkbooks.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">{t("noMyWorkbooks")}</p>
                ) : (
                  <>
                    {mySlice.map((wb) => (
                      <WorkbookCard key={wb.workbook_id} wb={wb} />
                    ))}
                    <Pagination current={myPage} total={myTotal} onChange={setMyPage} />
                  </>
                )}
              </div>
            )}
          </div>

          {/* 공유 교재 */}
          <div>
            <button
              onClick={() => setSharedExpanded(!sharedExpanded)}
              className="flex w-full items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-left transition-colors hover:bg-gray-100"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{t("sharedWorkbooks")}</span>
                <Badge variant="secondary" className="text-[10px]">{sharedWorkbooks.length}</Badge>
              </div>
              {sharedExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {sharedExpanded && (
              <div className="mt-2 space-y-2">
                {sharedWorkbooks.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">{t("noSharedWorkbooks")}</p>
                ) : (
                  <>
                    {sharedSlice.map((wb) => (
                      <WorkbookCard key={wb.workbook_id} wb={wb} showFork />
                    ))}
                    <Pagination current={sharedPage} total={sharedTotal} onChange={setSharedPage} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
