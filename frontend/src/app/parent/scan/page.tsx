"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createWorkbook,
  startScan,
  uploadScanPage,
  deleteScanPage,
  updateScanPageTags,
  processScan,
  cancelScan,
  getScanStatus,
  getAnswerKeys,
  getWorkbookAnswerKeys,
  editAnswerKey,
  deleteAnswerKey,
  regenerateScanDiagram,
  uploadScanProblemImage,
  fetchScanSourceImage,
  ocrProblemDescription,
  ocrExplanation,
  type ScanStatus,
  type AnswerKeyEntry,
} from "@/lib/api";
import { DIAGRAM, SCAN } from "@/lib/constants";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImageCropper } from "@/components/ImageCropper";
import { AnswerKeyCard } from "@/components/AnswerKeyCard";
import { latexToPlainLocal } from "@/lib/latex-to-plain";

type Step = (typeof SCAN.STEPS)[number];

interface UploadedPage {
  preview: string;
  tags: string[];
}

export default function ScanWizardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const existingWorkbookId = searchParams.get("workbook_id");
  const t = useTranslations("workbookDetail");
  const tScan = useTranslations("scan");
  const tCommon = useTranslations("common");
  const tVis = useTranslations("visibility");

  // Wizard state
  const [step, setStep] = useState<Step>(
    existingWorkbookId ? "pages" : "workbook"
  );
  const [error, setError] = useState("");

  // Step 1
  const [label, setLabel] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Step 2
  const [startPageIndex, setStartPageIndex] = useState(1);
  const [uploadedPages, setUploadedPages] = useState<UploadedPage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 3
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processStartTime, setProcessStartTime] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  // Step 4
  const [answerKeys, setAnswerKeys] = useState<AnswerKeyEntry[]>([]);
  const [openPageGroup, setOpenPageGroup] = useState<number | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null); // "page_number"
  const [editValue, setEditValue] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  // Expanded section: which card + which section (answer, problem, or explanation)
  const [expandedSection, setExpandedSection] = useState<{
    id: string;
    section: "answer" | "problem" | "explanation";
    editing: boolean;
  } | null>(null);
  const [editSteps, setEditSteps] = useState("");
  const [editPitfalls, setEditPitfalls] = useState("");
  const [editPageStart, setEditPageStart] = useState("");
  const [editPageEnd, setEditPageEnd] = useState("");
  const [editProblemDesc, setEditProblemDesc] = useState("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const [ocrTarget, setOcrTarget] = useState<{
    key: AnswerKeyEntry;
    section: "problem" | "explanation";
  } | null>(null);
  const [regenDiagramId, setRegenDiagramId] = useState<string | null>(null);
  const [convertingToTextId, setConvertingToTextId] = useState<string | null>(null);
  const [croppingKey, setCroppingKey] = useState<AnswerKeyEntry | null>(null);
  const [cropperImageUrl, setCropperImageUrl] = useState<string | null>(null);
  const [replacingImageId, setReplacingImageId] = useState<string | null>(null);

  const keyId = (k: AnswerKeyEntry) => `${k.page}_${k.number}`;

  // Auto-set startPageIndex from existing answer keys for existing workbook
  const [loadingExisting, setLoadingExisting] = useState(false);
  useEffect(() => {
    if (!existingWorkbookId) return;
    setLoadingExisting(true);
    getWorkbookAnswerKeys(existingWorkbookId)
      .then(({ answer_keys }) => {
        if (answer_keys.length > 0) {
          const maxPage = Math.max(...answer_keys.map((k) => k.page));
          setStartPageIndex(maxPage + 1);
        }
      })
      .catch(() => {
        // ignore — default to 1
      })
      .finally(() => setLoadingExisting(false));
  }, [existingWorkbookId]);

  // Start scan session (called from step 1 or step 2 for existing workbook)
  const ensureScanSession = useCallback(async (wbId: string, pageIdx: number) => {
    if (sessionId) return; // already created
    try {
      const session = await startScan(wbId, pageIdx);
      setSessionId(session.session_id);
    } catch {
      setError(t("scanStartFailed"));
    }
  }, [sessionId]);

  // --- Step 1 ---
  const handleCreateWorkbook = async () => {
    if (!label.trim()) return;
    setCreating(true);
    setError("");
    try {
      const wb = await createWorkbook(label.trim(), visibility);
      const session = await startScan(wb.workbook_id, startPageIndex);
      setSessionId(session.session_id);
      setStep("pages");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorOccurred"));
    } finally {
      setCreating(false);
    }
  };

  // --- Step 2 ---
  const handlePageCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      // Ensure session is created (for existing workbook flow)
      let sid = sessionId;
      if (!sid && existingWorkbookId) {
        const session = await startScan(existingWorkbookId, startPageIndex);
        sid = session.session_id;
        setSessionId(sid);
      }
      if (!sid) return;
      // Inherit tags from the last uploaded page, or fall back to defaults
      const prevTags =
        uploadedPages.length > 0
          ? [...uploadedPages[uploadedPages.length - 1].tags]
          : [...SCAN.DEFAULT_PAGE_TAGS];
      await uploadScanPage(sid, file, prevTags);
      setUploadedPages((prev) => [
        ...prev,
        { preview: URL.createObjectURL(file), tags: prevTags },
      ]);
    } catch {
      setError(t("uploadFailed"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleToggleTag = (index: number, tag: string) => {
    setUploadedPages((prev) =>
      prev.map((p, i) => {
        if (i !== index) return p;
        const has = p.tags.includes(tag);
        // Prevent removing the last tag
        if (has && p.tags.length <= 1) return p;
        const newTags = has
          ? p.tags.filter((t) => t !== tag)
          : [...p.tags, tag];
        return { ...p, tags: newTags };
      })
    );
  };

  const handleDeletePage = async (index: number) => {
    if (!sessionId) return;
    setError("");
    setDeletingIdx(index);
    try {
      await deleteScanPage(sessionId, index);
      setUploadedPages((prev) => prev.filter((_, i) => i !== index));
    } catch {
      setError(t("pageDeleteFailed"));
    } finally {
      setDeletingIdx(null);
    }
  };

  const isBusyUpload = uploading || deletingIdx !== null;

  // Elapsed time tracker during processing
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (processing && processStartTime) {
      elapsedRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - processStartTime) / 1000));
      }, 1000);
    }
    return () => {
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    };
  }, [processing, processStartTime]);

  // --- Step 3: Processing (now async with polling) ---
  const handleStartProcessing = async () => {
    if (!sessionId) return;
    setProcessing(true);
    setProcessStartTime(Date.now());
    setElapsedSec(0);
    setError("");
    setStep("processing");
    try {
      // Send page tag updates before processing
      const tagUpdates = uploadedPages.map((p, i) => ({
        index: i,
        tags: p.tags,
      }));
      await updateScanPageTags(sessionId, tagUpdates);
      await processScan(sessionId);
      startPolling();
    } catch {
      setError(t("analysisFailed"));
      setProcessing(false);
    }
  };

  const handleCancelProcessing = async () => {
    if (!sessionId) return;
    setCancelling(true);
    try {
      await cancelScan(sessionId);
    } catch {
      // Backend may have already finished — ignore
    }
    // Polling will pick up the "done" status from the cancel handler
  };

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Single poll check — shared by interval polling and visibility resume. */
  const checkScanOnce = useCallback(async () => {
    if (!sessionId) return;
    try {
      const status = await getScanStatus(sessionId);
      setScanStatus(status);
      if (status.status === "done" || status.status === "complete") {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        const keys = await getAnswerKeys(sessionId);
        setAnswerKeys(keys.answer_keys);
        // Auto-open the newly scanned page group (not the oldest)
        setOpenPageGroup(startPageIndex);
        setStep("verify");
        setProcessing(false);
        setCancelling(false);
        setProcessStartTime(null);
      }
    } catch {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      setProcessing(false);
      setCancelling(false);
      setProcessStartTime(null);
    }
  }, [sessionId, startPageIndex]);

  const startPolling = useCallback(() => {
    if (!sessionId || pollRef.current) return;
    pollRef.current = setInterval(checkScanOnce, SCAN.POLL_INTERVAL_MS);
  }, [sessionId, checkScanOnce]);

  // Resume polling immediately when screen wakes up / tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && processing && sessionId) {
        checkScanOnce();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [processing, sessionId, checkScanOnce]);

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // --- Step 4 ---
  const flashSaved = (id: string) => {
    setSavedKey(id);
    setTimeout(() => setSavedKey(null), 2000);
  };

  const handleEditAnswer = async (key: AnswerKeyEntry) => {
    if (!sessionId || !editValue.trim()) return;
    const id = keyId(key);
    setError("");
    setSaving(true);
    try {
      const updated = await editAnswerKey(sessionId, key.page, key.number, {
        final_answer: editValue.trim(),
      });
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
      );
      setEditingKey(null);
      setEditValue("");
      flashSaved(id);
    } catch {
      setError(t("editFailed"));
    } finally {
      setSaving(false);
    }
  };

  // Save answer (for expandable answer section)
  const handleSaveAnswer = async (key: AnswerKeyEntry) => {
    if (!sessionId || !editAnswer.trim()) return;
    const id = keyId(key);
    setError("");
    setSaving(true);
    try {
      const updated = await editAnswerKey(sessionId, key.page, key.number, {
        final_answer: editAnswer.trim(),
      });
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
      );
      setEditAnswer("");
      flashSaved(id);
      setExpandedSection({ id, section: "answer", editing: false });
    } catch {
      setError(t("editFailed"));
    } finally {
      setSaving(false);
    }
  };

  // Toggle section expansion
  const toggleSection = (key: AnswerKeyEntry, section: "answer" | "problem" | "explanation") => {
    const id = keyId(key);
    if (expandedSection?.id === id && expandedSection.section === section) {
      setExpandedSection(null);
      return;
    }
    setExpandedSection({ id, section, editing: false });
  };

  // Enter edit mode for a section
  const startEditSection = (key: AnswerKeyEntry, section: "problem" | "explanation") => {
    const id = keyId(key);
    if (section === "problem") {
      setEditProblemDesc(key.problem_description || "");
    } else {
      setEditSteps(key.solution_steps.map(latexToPlainLocal).join("\n"));
      setEditPitfalls(key.pitfalls.map(latexToPlainLocal).join("\n"));
      setEditPageStart(key.source_page_start?.toString() || "");
      setEditPageEnd(key.source_page_end?.toString() || "");
    }
    setExpandedSection({ id, section, editing: true });
  };

  // Save problem description
  const handleSaveProblem = async (key: AnswerKeyEntry) => {
    if (!sessionId) return;
    const id = keyId(key);
    setError("");
    setSaving(true);
    try {
      const updated = await editAnswerKey(sessionId, key.page, key.number, {
        problem_description: editProblemDesc.trim() || null,
      });
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
      );
      setExpandedSection({ id, section: "problem", editing: false });
      flashSaved(id);
    } catch {
      setError(t("problemEditFailed"));
    } finally {
      setSaving(false);
    }
  };

  // Save explanation (steps, pitfalls, page range)
  const handleSaveExplanation = async (key: AnswerKeyEntry) => {
    if (!sessionId) return;
    const id = keyId(key);
    setError("");
    setSaving(true);
    try {
      const data: Record<string, unknown> = {
        solution_steps: editSteps
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        pitfalls: editPitfalls
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      if (editPageStart) data.source_page_start = parseInt(editPageStart, 10);
      if (editPageEnd) data.source_page_end = parseInt(editPageEnd, 10);

      const updated = await editAnswerKey(sessionId, key.page, key.number, data);
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
      );
      setExpandedSection({ id, section: "explanation", editing: false });
      flashSaved(id);
    } catch {
      setError(t("explanationEditFailed"));
    } finally {
      setSaving(false);
    }
  };

  // Delete a problem
  const handleDeleteProblem = async (key: AnswerKeyEntry) => {
    if (!sessionId) return;
    if (!confirm(t("deleteConfirm", { page: key.page, number: key.number }))) return;
    setError("");
    try {
      await deleteAnswerKey(sessionId, key.page, key.number);
      setAnswerKeys((prev) => prev.filter((k) => keyId(k) !== keyId(key)));
      setExpandedSection(null);
    } catch {
      setError(t("deleteFailed"));
    }
  };

  // Clear problem description
  const handleClearProblem = async (key: AnswerKeyEntry) => {
    if (!sessionId) return;
    const id = keyId(key);
    setSaving(true);
    try {
      const updated = await editAnswerKey(sessionId, key.page, key.number, {
        problem_description: null,
      });
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
      );
      setExpandedSection(null);
      flashSaved(id);
    } catch {
      setError(t("deleteFailed"));
    } finally {
      setSaving(false);
    }
  };

  // Clear explanation
  const handleClearExplanation = async (key: AnswerKeyEntry) => {
    if (!sessionId) return;
    const id = keyId(key);
    setSaving(true);
    try {
      const updated = await editAnswerKey(sessionId, key.page, key.number, {
        solution_steps: [],
        pitfalls: [],
      });
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
      );
      setExpandedSection(null);
      flashSaved(id);
    } catch {
      setError(t("deleteFailed"));
    } finally {
      setSaving(false);
    }
  };

  // Toggle review_enabled / verify_enabled
  const handleToggleFlag = async (
    key: AnswerKeyEntry,
    field: "review_enabled" | "verify_enabled",
  ) => {
    if (!sessionId) return;
    const id = keyId(key);
    try {
      const updated = await editAnswerKey(sessionId, key.page, key.number, {
        [field]: !key[field],
      });
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
      );
    } catch {
      setError(t("settingsFailed"));
    }
  };

  // Regenerate diagram SVG for a scan entry
  const handleRegenDiagram = async (key: AnswerKeyEntry) => {
    if (!sessionId) return;
    const id = keyId(key);
    setRegenDiagramId(id);
    setError("");
    try {
      const updated = await regenerateScanDiagram(sessionId, key.page, key.number);
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
      );
      flashSaved(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("diagramRegenFailed"));
    } finally {
      setRegenDiagramId(null);
    }
  };

  // Open cropper for replacing diagram with original image crop
  const openImageCropper = async (key: AnswerKeyEntry) => {
    if (!sessionId) return;
    setError("");
    try {
      const blobUrl = await fetchScanSourceImage(sessionId, key.page, key.number);
      setCropperImageUrl(blobUrl);
      setCroppingKey(key);
    } catch {
      setError(t("sourceImageFailed"));
    }
  };

  const closeCropper = () => {
    if (cropperImageUrl) URL.revokeObjectURL(cropperImageUrl);
    setCropperImageUrl(null);
    setCroppingKey(null);
  };

  // Handle crop completion: upload cropped image → update entry
  const handleCropDone = async (croppedFile: File) => {
    if (!sessionId || !croppingKey) return;
    const key = croppingKey;
    const id = keyId(key);
    closeCropper();
    setReplacingImageId(id);
    setError("");
    try {
      const { url } = await uploadScanProblemImage(sessionId, croppedFile);
      const updated = await editAnswerKey(sessionId, key.page, key.number, {
        problem_image_url: url,
        image_dependent: true,
        verify_enabled: false,
        diagram_svg: null,
      });
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
      );
      flashSaved(id);
    } catch {
      setError(t("sourceImageReplaceFailed"));
    } finally {
      setReplacingImageId(null);
    }
  };

  // Revert from original image back to diagram
  const handleRevertToDiagram = async (key: AnswerKeyEntry) => {
    if (!sessionId) return;
    const id = keyId(key);
    setReplacingImageId(id);
    setError("");
    try {
      const updated = await editAnswerKey(sessionId, key.page, key.number, {
        problem_image_url: null,
        image_dependent: false,
      });
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
      );
      flashSaved(id);
    } catch {
      setError(t("revertFailed"));
    } finally {
      setReplacingImageId(null);
    }
  };

  // Convert to text-only: strip diagram/image, keep text
  const handleConvertToText = async (key: AnswerKeyEntry) => {
    if (!sessionId) return;
    const id = keyId(key);
    setConvertingToTextId(id);
    setError("");
    try {
      const updated = await editAnswerKey(sessionId, key.page, key.number, {
        diagram_svg: null,
        problem_image_url: null,
        image_dependent: false,
        review_enabled: true,
        verify_enabled: true,
      });
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
      );
      flashSaved(id);
    } catch {
      setError(t("textConvertFailed"));
    } finally {
      setConvertingToTextId(null);
    }
  };

  // OCR: trigger file input
  const triggerOcr = (key: AnswerKeyEntry, section: "problem" | "explanation") => {
    setOcrTarget({ key, section });
    ocrFileRef.current?.click();
  };

  // OCR: handle file selected
  const handleOcrFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !ocrTarget || !sessionId) return;
    if (ocrFileRef.current) ocrFileRef.current.value = "";

    const { key, section } = ocrTarget;
    const id = keyId(key);
    setOcrLoading(true);
    setError("");
    try {
      if (section === "problem") {
        const res = await ocrProblemDescription(sessionId, file);
        setEditProblemDesc(res.text);
        setExpandedSection({ id, section: "problem", editing: true });
      } else {
        const res = await ocrExplanation(sessionId, file);
        setEditSteps(res.solution_steps.join("\n"));
        setEditPitfalls(res.pitfalls.join("\n"));
        setExpandedSection({ id, section: "explanation", editing: true });
      }
    } catch {
      setError(tScan("ocrFailed"));
    } finally {
      setOcrLoading(false);
      setOcrTarget(null);
    }
  };

  // Group answer keys by page for collapsible sections
  const pageGroups = answerKeys.reduce<Record<number, AnswerKeyEntry[]>>(
    (acc, key) => {
      (acc[key.page] ??= []).push(key);
      return acc;
    },
    {},
  );
  const sortedPages = Object.keys(pageGroups)
    .map(Number)
    .sort((a, b) => a - b);

  const handleConfirmDone = () => {
    if (existingWorkbookId) {
      router.push(`/parent/workbook/${existingWorkbookId}`);
    } else {
      router.push("/parent/workbooks");
    }
  };

  const stepIndex = SCAN.STEPS.indexOf(step);

  return (
    <div className="mx-auto max-w-sm space-y-6">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2">
        {SCAN.STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                i < stepIndex
                  ? "bg-green-100 text-green-700"
                  : i === stepIndex
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {i < stepIndex ? "✓" : i + 1}
            </div>
            {i < SCAN.STEPS.length - 1 && (
              <div
                className={`h-0.5 w-6 ${
                  i < stepIndex ? "bg-green-300" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Step 1: Workbook setup */}
      {step === "workbook" && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">{tScan("stepLabels.workbook")}</h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">
                {tScan("workbookName")}
              </label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t("workbookNamePlaceholder")}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">
                {tVis("public")} / {tVis("private")}
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={visibility === "public" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setVisibility("public")}
                >
                  {tVis("public")}
                </Button>
                <Button
                  type="button"
                  variant={visibility === "private" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setVisibility("private")}
                >
                  {tVis("private")}
                </Button>
              </div>
            </div>
          </div>
          <Button
            onClick={handleCreateWorkbook}
            disabled={!label.trim() || creating}
            className="w-full"
            size="lg"
          >
            {creating ? tScan("creating") : tCommon("next")}
          </Button>
        </div>
      )}

      {/* Step 2: Pages with type tags */}
      {step === "pages" && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">
            {existingWorkbookId ? t("addAnswerPages") : t("takePages")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {tScan("pageTypeHint")}
          </p>

          {/* Image quality guide */}
          {uploadedPages.length === 0 && (
            <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700 space-y-1.5">
              <p className="font-medium">{tScan("photoGuideTitle")}</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>{tScan("guideResolution")}</li>
                <li>{tScan("guidePixels")}</li>
                <li>{tScan("guideFill")}</li>
                <li>{tScan("guideLighting")}</li>
                <li>{tScan("guideSplit")}</li>
              </ul>
            </div>
          )}

          {/* Start page index — prevents doc ID collision on additional scans */}
          {existingWorkbookId && uploadedPages.length === 0 && (
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">
                {tScan("startPageLabel")}
              </label>
              <Input
                type="number"
                inputMode="numeric"
                value={String(startPageIndex)}
                onChange={(e) => setStartPageIndex(parseInt(e.target.value) || 1)}
                className="w-24"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {tScan("startPageHint")}
              </p>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePageCapture}
          />

          {uploadedPages.length > 0 && (
            <div className="space-y-2">
              {uploadedPages.map((page, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border p-2">
                  <img
                    src={page.preview}
                    alt={tScan("pageAlt", { index: i + 1 })}
                    className="h-16 w-12 rounded border object-cover"
                  />
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">{tCommon("page")} {i + 1}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(["answer", "explanation", "question"] as const).map(
                        (tag) => {
                          const active = page.tags.includes(tag);
                          return (
                            <button
                              key={tag}
                              onClick={() => handleToggleTag(i, tag)}
                              className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                                active
                                  ? tag === "question"
                                    ? "bg-purple-600 text-white"
                                    : tag === "explanation"
                                      ? "bg-blue-600 text-white"
                                      : "bg-indigo-600 text-white"
                                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                              }`}
                            >
                              {tScan(`pageTags.${tag}`)}
                            </button>
                          );
                        }
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeletePage(i)}
                    disabled={isBusyUpload}
                    className={`rounded p-1 transition-colors ${
                      deletingIdx === i
                        ? "animate-spin text-red-500"
                        : isBusyUpload
                          ? "text-gray-200 cursor-not-allowed"
                          : "text-gray-400 hover:bg-red-50 hover:text-red-500"
                    }`}
                    title={tCommon("delete")}
                  >
                    {deletingIdx === i ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusyUpload || loadingExisting}
            className="w-full"
          >
            {uploading
              ? tCommon("uploading")
              : deletingIdx !== null
                ? tCommon("deleting")
                : loadingExisting
                  ? tCommon("checking")
                  : uploadedPages.length === 0
                    ? t("pageImageInput")
                    : tScan("additionalDone", { count: uploadedPages.length })}
          </Button>

          <div className="flex gap-3">
            {!existingWorkbookId && (
              <Button
                variant="outline"
                onClick={() => setStep("workbook")}
                className="flex-1"
              >
                {tScan("previous")}
              </Button>
            )}
            <Button
              onClick={handleStartProcessing}
              disabled={uploadedPages.length === 0 || isBusyUpload}
              className="flex-1"
            >
              {tScan("startAnalysis")}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Processing with progress */}
      {step === "processing" && (
        <div className="flex flex-col items-center gap-4 py-10">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
          <p className="font-medium text-gray-700">
            {scanStatus?.progress_message || t("analyzing")}
          </p>

          {/* Elapsed time */}
          <p className="text-xs text-muted-foreground">
            {tScan("elapsedTime", { time: `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}` })}
          </p>

          {/* Progress bar */}
          {scanStatus && scanStatus.progress_pct > 0 && (
            <div className="w-full max-w-xs">
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-indigo-600 transition-all duration-500"
                  style={{ width: `${scanStatus.progress_pct}%` }}
                />
              </div>
              <p className="mt-1 text-center text-xs text-muted-foreground">
                {scanStatus.progress_pct}%
              </p>
            </div>
          )}

          {scanStatus && (scanStatus.answers_found > 0 || scanStatus.problem_descriptions_found > 0) && (
            <div className="mt-2 text-center text-xs text-muted-foreground">
              <p>{tScan("answersExtracted", { count: scanStatus.answers_found })}</p>
              <p>{tScan("explanationsExtracted", { count: scanStatus.explanations_found })}</p>
              {scanStatus.problem_descriptions_found > 0 && (
                <p>{tScan("problemsExtracted", { count: scanStatus.problem_descriptions_found })}</p>
              )}
            </div>
          )}

          {/* Slow warning — staircase: ceil(pages / concurrency) * MS_PER_BATCH + diagram time */}
          {(() => {
            const batches = Math.ceil(uploadedPages.length / SCAN.PARALLEL_CONCURRENCY) || 1;
            const hasQuestionPages = uploadedPages.some((p) => p.tags?.includes("question"));
            const slowMs = batches * SCAN.MS_PER_BATCH + (hasQuestionPages ? SCAN.DIAGRAM_EXTRA_MS : 0);
            return elapsedSec * 1000 >= slowMs ? (
              <div className="w-full max-w-xs rounded-lg bg-yellow-50 p-3 text-center">
                <p className="text-xs text-yellow-700">
                  {tScan("slowWarning")}
                </p>
              </div>
            ) : null;
          })()}

          {/* Cancel button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancelProcessing}
            disabled={cancelling}
            className="mt-2 text-red-600 border-red-200 hover:bg-red-50"
          >
            {cancelling ? t("cancelling") : t("cancelAnalysis")}
          </Button>
        </div>
      )}

      {/* Step 4: Verification & Lock */}
      {step === "verify" && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">{tScan("verifyTitle")}</h3>

          {/* Hidden OCR file input */}
          <input
            ref={ocrFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleOcrFile}
          />

          {/* OCR loading overlay */}
          {ocrLoading && (
            <div className="flex items-center gap-2 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-700">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
              {t("ocrExtracting")}
            </div>
          )}

          {/* Summary */}
          <Card>
            <CardContent className="space-y-2 p-4">
              <div className="flex justify-between text-sm">
                <span>{tScan("answerExtraction")}</span>
                <span className="font-medium text-green-600">
                  {tScan("countUnit", { count: answerKeys.length })}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>{tScan("explanationIncluded")}</span>
                <span className="font-medium text-blue-600">
                  {tScan("countUnit", { count: answerKeys.filter((k) => k.solution_steps.length > 0).length })}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>{tScan("problemData")}</span>
                <span className="font-medium text-purple-600">
                  {tScan("countUnit", { count: answerKeys.filter((k) => k.problem_description).length })}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>{tScan("pageGroups")}</span>
                <span className="font-medium">{tScan("countUnit", { count: sortedPages.length })}</span>
              </div>
              {scanStatus?.warnings && scanStatus.warnings.length > 0 && (
                <div className="mt-2 rounded-lg bg-yellow-50 p-2">
                  <p className="text-xs font-medium text-yellow-700">
                    {tScan("warnings", { count: scanStatus.warnings.length })}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {scanStatus.warnings.slice(0, 5).map((w, i) => (
                      <li key={i} className="text-xs text-yellow-600">
                        {w}
                      </li>
                    ))}
                    {scanStatus.warnings.length > 5 && (
                      <li className="text-xs text-yellow-500">
                        {tScan("moreWarnings", { count: scanStatus.warnings.length - 5 })}
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Page groups — collapsible sections */}
          <div className="space-y-2">
            {sortedPages.map((pg) => {
              const groupKeys = pageGroups[pg];
              const isOpen = openPageGroup === pg;
              const first = groupKeys[0];
              const rangeLabel =
                first.source_page_start
                  ? `p.${first.source_page_start}${first.source_page_end && first.source_page_end !== first.source_page_start ? `~${first.source_page_end}` : ""}`
                  : null;

              return (
                <div key={pg}>
                  {/* Page group header */}
                  <button
                    onClick={() => setOpenPageGroup(isOpen ? null : pg)}
                    className="flex w-full items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5 text-left transition-colors hover:bg-gray-100"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {t("answerSheet", { page: pg })}
                        {rangeLabel && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            ({rangeLabel})
                          </span>
                        )}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {t("problemCount", { count: groupKeys.length })}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {isOpen ? tCommon("collapse") : tCommon("expand")}
                    </span>
                  </button>

                  {/* Answer cards within group */}
                  {isOpen && (
                    <div className="mt-1 space-y-1.5 pl-1">
                      {groupKeys.map((key) => {
                        const id = keyId(key);
                        const isEditingAns = editingKey === id;
                        const expSec = expandedSection?.id === id ? expandedSection : null;

                        return (
                          <AnswerKeyCard
                            key={id}
                            entry={key}
                            id={id}
                            expandedSection={expSec}
                            isOwner={true}
                            showSaved={savedKey === id}
                            editState={{
                              answer: editAnswer,
                              problemDesc: editProblemDesc,
                              steps: editSteps,
                              pitfalls: editPitfalls,
                              pageStart: editPageStart,
                              pageEnd: editPageEnd,
                            }}
                            loadingState={{
                              saving,
                              ocr: ocrLoading,
                              ocrSection: ocrTarget?.section,
                              diagram: regenDiagramId === id,
                              convertText: convertingToTextId === id,
                              replaceImage: replacingImageId === id,
                            }}
                            callbacks={{
                              onToggleSection: (s) => toggleSection(key, s),
                              onSetExpanded: (s, editing) => setExpandedSection({ id, section: s, editing }),
                              onDelete: () => handleDeleteProblem(key),
                              onEditChange: (field, value) => {
                                if (field === "answer") setEditAnswer(value);
                                else if (field === "problemDesc") setEditProblemDesc(value);
                                else if (field === "steps") setEditSteps(value);
                                else if (field === "pitfalls") setEditPitfalls(value);
                                else if (field === "pageStart") setEditPageStart(value);
                                else if (field === "pageEnd") setEditPageEnd(value);
                              },
                              onSaveAnswer: () => handleSaveAnswer(key),
                              onStartEditAnswer: () => {
                                setEditAnswer(latexToPlainLocal(key.final_answer));
                                setExpandedSection({ id, section: "answer", editing: true });
                              },
                              onSaveProblem: () => handleSaveProblem(key),
                              onStartEditProblem: () => startEditSection(key, "problem"),
                              onClearProblem: () => handleClearProblem(key),
                              onSaveExplanation: () => handleSaveExplanation(key),
                              onStartEditExplanation: () => startEditSection(key, "explanation"),
                              onClearExplanation: () => handleClearExplanation(key),
                              onToggleFlag: (flag) => handleToggleFlag(key, flag),
                              onOcr: (section) => triggerOcr(key, section),
                              onRegenDiagram: () => handleRegenDiagram(key),
                              onRevertToDiagram: () => handleRevertToDiagram(key),
                              onConvertToText: () => handleConvertToText(key),
                              onOpenImageCropper: () => openImageCropper(key),
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {answerKeys.length === 0 && !scanStatus?.problem_descriptions_found && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {tScan("noAnswersExtracted")}
            </p>
          )}

          {answerKeys.length === 0 && !!scanStatus?.problem_descriptions_found && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {tScan("problemsRegistered", { count: scanStatus.problem_descriptions_found })}
            </p>
          )}

          {/* Done button — workbook is already auto-locked after processing */}
          <Button
            onClick={handleConfirmDone}
            className="w-full bg-green-600 hover:bg-green-700"
            size="lg"
          >
            {tScan("confirmDone")}
          </Button>
        </div>
      )}
      {/* Image Cropper overlay for "원본이미지로 대체" */}
      {croppingKey && cropperImageUrl && (
        <ImageCropper
          imageSrc={cropperImageUrl}
          onCropDone={handleCropDone}
          onCancel={closeCropper}
        />
      )}
    </div>
  );
}
