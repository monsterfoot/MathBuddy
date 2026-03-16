"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listWorkbooks, listAllDisputes, listAllRegenRequests, type Workbook } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";

export default function ParentDashboard() {
  const t = useTranslations("parent");
  const [workbookCount, setWorkbookCount] = useState(0);
  const [pendingDisputeCount, setPendingDisputeCount] = useState(0);
  const [pendingRegenCount, setPendingRegenCount] = useState(0);

  useEffect(() => {
    listWorkbooks()
      .then((wbs) => setWorkbookCount(wbs.length))
      .catch(() => setWorkbookCount(0));
    listAllDisputes("pending")
      .then((res) => setPendingDisputeCount(res.disputes.length))
      .catch(() => setPendingDisputeCount(0));
    listAllRegenRequests("pending")
      .then((res) => setPendingRegenCount(res.requests.length))
      .catch(() => setPendingRegenCount(0));
  }, []);

  return (
    <div className="mx-auto max-w-sm space-y-3">
      <Link href="/parent/workbooks">
        <Card className="transition-colors hover:bg-muted/50">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{t("workbookManagement")}</p>
              <p className="text-xs text-muted-foreground">
                {t("workbookManagementDesc")}
              </p>
            </div>
            {workbookCount > 0 ? (
              <Badge variant="outline">{workbookCount}</Badge>
            ) : (
              <Badge variant="outline">{t("manage")}</Badge>
            )}
          </CardContent>
        </Card>
      </Link>

      <Link href="/parent/students">
        <Card className="transition-colors hover:bg-muted/50">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{t("studentManagement")}</p>
              <p className="text-xs text-muted-foreground">
                {t("studentManagementDesc")}
              </p>
            </div>
            <Badge variant="outline">{t("students")}</Badge>
          </CardContent>
        </Card>
      </Link>

      <Link href="/parent/review">
        <Card className="transition-colors hover:bg-muted/50">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{t("reviewCardManagement")}</p>
              <p className="text-xs text-muted-foreground">
                {t("reviewCardManagementDesc")}
              </p>
            </div>
            <Badge variant="outline">{t("manage")}</Badge>
          </CardContent>
        </Card>
      </Link>

      <Link href="/parent/disputes">
        <Card className="transition-colors hover:bg-muted/50">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{t("disputeManagement")}</p>
              <p className="text-xs text-muted-foreground">
                {t("disputeManagementDesc")}
              </p>
            </div>
            {pendingDisputeCount > 0 ? (
              <Badge variant="destructive">{pendingDisputeCount}</Badge>
            ) : (
              <Badge variant="outline">{t("manage")}</Badge>
            )}
          </CardContent>
        </Card>
      </Link>

      <Link href="/parent/regen-requests">
        <Card className="transition-colors hover:bg-muted/50">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{t("regenManagement")}</p>
              <p className="text-xs text-muted-foreground">
                {t("regenManagementDesc")}
              </p>
            </div>
            {pendingRegenCount > 0 ? (
              <Badge variant="destructive">{pendingRegenCount}</Badge>
            ) : (
              <Badge variant="outline">{t("manage")}</Badge>
            )}
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
