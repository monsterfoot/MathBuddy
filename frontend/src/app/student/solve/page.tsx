"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  gradeSubmission,
  getNextProblem,
  getWorkbookAnswerKeys,
  getStudyRecords,
  createDispute,
  markCoached,
  markMastered,
  type AnswerKeyEntry,
} from "@/lib/api";
import { useAppStore } from "@/lib/store";
import {
  GRADING,
  LOCKED_STATUSES,
  SOLVE_PHASE,
  STUDY_STATUS_COLORS,
} from "@/lib/constants";
import { useTranslations } from "next-intl";
import { useErrorTagLabel } from "@/lib/i18n-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImageCropper } from "@/components/ImageCropper";
import { MathText } from "@/components/MathText";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";

/** A unique page range group derived from answer keys. */
interface PageRange {
  /** Internal page value (Firestore doc ID part, e.g. 2). */
  internalPage: number;
  /** Display label e.g. "p.41~43" or "Answer Sheet 1". */
  label: string;
  /** Problem numbers in this range. */
  numbers: number[];
}

export default function SolvePage() {
  const router = useRouter();
  const workbookId = useAppStore((s) => s.workbookId);

  const currentPage = useAppStore((s) => s.currentPage);
  const currentNumber = useAppStore((s) => s.currentNumber);
  const setCurrentProblem = useAppStore((s) => s.setCurrentProblem);

  const solvePhase = useAppStore((s) => s.solvePhase);
  const setSolvePhase = useAppStore((s) => s.setSolvePhase);
  const problemPhoto = useAppStore((s) => s.problemPhoto);
  const setProblemPhoto = useAppStore((s) => s.setProblemPhoto);
  const workPhoto = useAppStore((s) => s.workPhoto);
  const setWorkPhoto = useAppStore((s) => s.setWorkPhoto);
  const gradeResult = useAppStore((s) => s.gradeResult);
  const setGradeResult = useAppStore((s) => s.setGradeResult);
  const setCurrentAttemptId = useAppStore((s) => s.setCurrentAttemptId);
  const setWasCorrectEntry = useAppStore((s) => s.setWasCorrectEntry);
  const setVariantProblem = useAppStore((s) => s.setVariantProblem);
  const setVerifyWorkPhoto = useAppStore((s) => s.setVerifyWorkPhoto);
  const setCurrentDiagramSvg = useAppStore((s) => s.setCurrentDiagramSvg);
  const resetToSolve = useAppStore((s) => s.resetToSolve);
  const hasTeachers = useAppStore((s) => s.hasTeachers);
  const isSoloStudy = useAppStore((s) => s.isSoloStudy);

  const tCommon = useTranslations("common");
  const t = useTranslations("solve");
  const errorTagLabel = useErrorTagLabel();

  const [directAnswer, setDirectAnswer] = useState("");
  const [gradingElapsed, setGradingElapsed] = useState(0);
  const [gradingError, setGradingError] = useState<string | null>(null);
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeSubmitted, setDisputeSubmitted] = useState(false);
  const gradingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Problem status (correct/wrong/coached/mastered) from Firestore
  const [problemStatuses, setProblemStatuses] = useState<Record<string, string>>({});
  const [lastAttemptIds, setLastAttemptIds] = useState<Record<string, string>>({});
  const [savedVariants, setSavedVariants] = useState<Record<string, { display_text: string; correct_answer: string }>>({});

  // Crop state: which photo is being cropped
  const [cropTarget, setCropTarget] = useState<"problem" | "work" | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  // Answer key data
  const [allKeys, setAllKeys] = useState<AnswerKeyEntry[]>([]);
  const [pageRanges, setPageRanges] = useState<PageRange[]>([]);
  const [selectedRange, setSelectedRange] = useState<PageRange | null>(null);

  // Stored problem description text (from workbook DB)
  const [storedProblemDesc, setStoredProblemDesc] = useState<string | null>(null);
  const [storedDiagramSvg, setStoredDiagramSvg] = useState<string | null>(null);
  const [storedProblemImageUrl, setStoredProblemImageUrl] = useState<string | null>(null);

  // Cleanup grading timer on unmount
  useEffect(() => {
    return () => stopGradingTimer();
  }, []);

  // Load answer keys and problem statuses when workbook is set
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState(false);

  const loadKeys = async (wbId: string) => {
    setKeysLoading(true);
    setKeysError(false);
    try {
      const res = await getWorkbookAnswerKeys(wbId);
      setAllKeys(res.answer_keys);
    } catch {
      setKeysError(true);
    } finally {
      setKeysLoading(false);
    }
  };

  const idToken = useAppStore((s) => s.idToken);

  useEffect(() => {
    if (!workbookId) return;
    loadKeys(workbookId);
    getStudyRecords(workbookId)
      .then((res) => {
        setProblemStatuses(res.statuses);
        setLastAttemptIds(res.last_attempt_ids || {});
        setSavedVariants(res.saved_variants || {});
      })
      .catch(() => {/* ignore */});
    // idToken in deps: re-run when token becomes available after mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbookId, idToken]);

  // Reset per-problem state when switching problems
  useEffect(() => {
    setDirectAnswer("");
    setDisputeSubmitted(false);
    setDisputeSubmitting(false);
  }, [currentPage, currentNumber]);

  // Check if current problem has a stored problem description
  useEffect(() => {
    if (!allKeys.length) {
      setStoredProblemDesc(null);
      setStoredDiagramSvg(null);
      setStoredProblemImageUrl(null);
      return;
    }
    const key = allKeys.find(
      (k) => k.page === currentPage && k.number === currentNumber,
    );
    setStoredProblemDesc(key?.problem_description || null);
    const svg = key?.diagram_svg || null;
    setStoredDiagramSvg(svg);
    setCurrentDiagramSvg(svg);
    setStoredProblemImageUrl(key?.problem_image_url || null);
  }, [currentPage, currentNumber, allKeys]);

  // Build page ranges from answer keys
  useEffect(() => {
    if (!allKeys.length) {
      setPageRanges([]);
      return;
    }

    // Group by internal page
    const groups = new Map<number, AnswerKeyEntry[]>();
    for (const key of allKeys) {
      const list = groups.get(key.page) ?? [];
      list.push(key);
      groups.set(key.page, list);
    }

    const ranges: PageRange[] = [];
    for (const [internalPage, keys] of groups) {
      const first = keys[0];
      const start = first.source_page_start;
      const end = first.source_page_end;
      let label: string;
      if (start) {
        label = end && end !== start ? `p.${start}~${end}` : `p.${start}`;
      } else {
        label = t("answerPage", { page: internalPage });
      }
      const numbers = keys.map((k) => k.number).sort((a, b) => a - b);
      ranges.push({ internalPage, label, numbers });
    }

    ranges.sort((a, b) => a.internalPage - b.internalPage);
    setPageRanges(ranges);

    // Auto-select if currentPage matches an internal page
    const match = ranges.find((r) => r.internalPage === currentPage);
    if (match) {
      setSelectedRange(match);
    } else if (ranges.length > 0 && !selectedRange) {
      // Default: select the first range
      setSelectedRange(ranges[0]);
      setCurrentProblem(ranges[0].internalPage, ranges[0].numbers[0] ?? 1);
    }
  }, [allKeys]);

  // When range selection changes, update currentPage to internal page
  const handleSelectRange = (rangeIdx: number) => {
    const range = pageRanges[rangeIdx];
    if (!range) return;
    setSelectedRange(range);
    setCurrentProblem(range.internalPage, range.numbers[0] ?? 1);
  };

  // Display label for the current problem header
  const displayLabel = selectedRange
    ? `${selectedRange.label} ${t("numberLabel", { num: currentNumber })}`
    : `${currentPage}${tCommon("page")} ${t("numberLabel", { num: currentNumber })}`;

  const problemFileRef = useRef<HTMLInputElement>(null);
  const workFileRef = useRef<HTMLInputElement>(null);

  const problemPreview = problemPhoto
    ? URL.createObjectURL(problemPhoto)
    : null;
  const workPreview = workPhoto ? URL.createObjectURL(workPhoto) : null;

  const handleProblemCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropTarget("problem");
    setCropSrc(URL.createObjectURL(file));
  };

  const handleWorkCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropTarget("work");
    setCropSrc(URL.createObjectURL(file));
  };

  const handleCropDone = (croppedFile: File) => {
    if (cropTarget === "problem") {
      setProblemPhoto(croppedFile);
      setSolvePhase(SOLVE_PHASE.WORK_PHOTO);
    } else if (cropTarget === "work") {
      setWorkPhoto(croppedFile);
    }
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropTarget(null);
    setCropSrc(null);
  };

  const handleCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropTarget(null);
    setCropSrc(null);
  };

  const stopGradingTimer = () => {
    if (gradingTimerRef.current) {
      clearInterval(gradingTimerRef.current);
      gradingTimerRef.current = null;
    }
  };

  const handleGrade = async () => {
    const workFile = workPhoto;
    const answerText = directAnswer.trim() || null;
    if (!workFile && !answerText) return;

    setSolvePhase(SOLVE_PHASE.GRADING);
    setGradingError(null);
    setGradingElapsed(0);
    const t0 = Date.now();
    gradingTimerRef.current = setInterval(() => {
      setGradingElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 1000);

    try {
      const res = await gradeSubmission(
        workbookId || "demo",
        currentPage,
        currentNumber,
        workFile,
        problemPhoto,
        answerText,
      );
      setGradeResult(res);
      setCurrentAttemptId(res.attempt_id);
      setSolvePhase(SOLVE_PHASE.RESULT);

      // Update problem status in local state (backend saves to Firestore automatically)
      if (res.error_tag !== "retake_needed" && workbookId) {
        const key = `${currentPage}_${currentNumber}`;
        const result = res.is_correct ? "correct" : "wrong";
        setProblemStatuses((prev) => ({ ...prev, [key]: result }));
        setLastAttemptIds((prev) => ({ ...prev, [key]: res.attempt_id }));
      }
    } catch (err) {
      setGradingError(err instanceof Error ? err.message : t("gradingError"));
      setSolvePhase(SOLVE_PHASE.WORK_PHOTO);
    } finally {
      stopGradingTimer();
    }
  };

  const handleNextProblem = async () => {
    try {
      const next = await getNextProblem(
        workbookId || "demo",
        currentPage,
        currentNumber,
      );
      if (next.page != null && next.number != null) {
        setCurrentProblem(next.page, next.number);
        // Auto-select matching range
        const matchRange = pageRanges.find((r) => r.internalPage === next.page);
        if (matchRange) setSelectedRange(matchRange);
      } else {
        alert(t("allComplete"));
      }
    } catch {
      // Fallback: stay on current
    }
    resetToSolve();
  };

  const startCoaching = (isCorrect: boolean) => {
    if (!gradeResult) return;
    setWasCorrectEntry(isCorrect);
    const currentKey = allKeys.find(
      (k) => k.page === currentPage && k.number === currentNumber,
    );
    const verifyEnabled = currentKey?.verify_enabled !== false;
    router.push(
      `/student/coach?attempt_id=${gradeResult.attempt_id}&verify=${verifyEnabled}`,
    );
  };

  const handleDispute = async () => {
    if (!gradeResult || !workbookId) return;
    setDisputeSubmitting(true);
    try {
      await createDispute(
        gradeResult.attempt_id,
        workbookId,
        currentPage,
        currentNumber,
        gradeResult.student_answer || "",
        gradeResult.correct_answer || "",
        gradeResult.problem_description || "",
      );
      setDisputeSubmitted(true);
      // Update local status to disputed
      const key = `${currentPage}_${currentNumber}`;
      setProblemStatuses((prev) => ({ ...prev, [key]: "disputed" }));
    } catch {
      // silently fail — user can try again
    } finally {
      setDisputeSubmitting(false);
    }
  };

  /** Display "choice:3" as "#3", otherwise as-is. */
  const formatAnswer = (raw: string | null | undefined) => {
    if (!raw) return "—";
    const m = raw.match(/^choice:(\d)$/);
    return m ? t("numberLabel", { num: m[1] }) : raw;
  };

  const canGrade = !!workPhoto || !!directAnswer.trim();

  return (
    <div className="mx-auto max-w-sm space-y-6 pb-20">
      {/* Image cropper overlay */}
      {cropSrc && cropTarget && (
        <ImageCropper
          imageSrc={cropSrc}
          onCropDone={handleCropDone}
          onCancel={handleCropCancel}
        />
      )}

      <h3 className="text-lg font-semibold">
        {t("title")}{displayLabel}
      </h3>

      {/* Phase 1: Problem input */}
      {solvePhase === SOLVE_PHASE.INPUT && (
        <>
          {/* Page range dropdown */}
          {keysLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : keysError ? (
            <div className="flex flex-col items-center gap-2 py-4">
              <p className="text-sm text-destructive">{tCommon("loadFailed")}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => workbookId && loadKeys(workbookId)}
              >
                {tCommon("retry")}
              </Button>
            </div>
          ) : pageRanges.length > 0 ? (
            <div>
              <Label className="mb-1 text-muted-foreground">{t("selectPage")}</Label>
              <Select
                value={String(selectedRange ? pageRanges.indexOf(selectedRange) : 0)}
                onValueChange={(v) => handleSelectRange(Number(v))}
              >
                <SelectTrigger className="w-full text-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageRanges.map((range, idx) => (
                    <SelectItem key={range.internalPage} value={String(idx)}>
                      {range.label} ({t("itemCount", { count: range.numbers.length })})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex gap-3">
              <div className="flex-1">
                <Label className="mb-1 text-muted-foreground">{t("pageLabel")}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={String(currentPage)}
                  onChange={(e) =>
                    setCurrentProblem(
                      parseInt(e.target.value) || 1,
                      currentNumber
                    )
                  }
                  placeholder="5"
                  className="text-center text-lg"
                />
              </div>
              <div className="flex-1">
                <Label className="mb-1 text-muted-foreground">{t("problemNumber")}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={String(currentNumber)}
                  onChange={(e) =>
                    setCurrentProblem(
                      currentPage,
                      parseInt(e.target.value) || 1
                    )
                  }
                  placeholder="3"
                  className="text-center text-lg"
                />
              </div>
            </div>
          )}

          {/* Problem number buttons */}
          {selectedRange && selectedRange.numbers.length > 0 && (
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="mb-2 text-xs font-medium text-gray-600">
                {t("problemsOnPage", { count: selectedRange.numbers.length })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selectedRange.numbers.map((num) => {
                  const problemKey = `${selectedRange.internalPage}_${num}`;
                  const status = problemStatuses[problemKey];
                  const isSelected = currentNumber === num;
                  const isLocked = LOCKED_STATUSES.includes(
                    status as (typeof LOCKED_STATUSES)[number],
                  );
                  const bgClass =
                    (status && STUDY_STATUS_COLORS[status]) ||
                    "bg-white text-gray-700";
                  const borderClass = isSelected
                    ? "ring-2 ring-blue-500"
                    : "hover:ring-1 hover:ring-gray-300";

                  return (
                    <button
                      key={num}
                      onClick={() => {
                        if (isLocked) return;
                        setCurrentProblem(selectedRange.internalPage, num);

                        const attemptId = lastAttemptIds[problemKey];
                        if (status === "wrong" && attemptId) {
                          const key = allKeys.find(
                            (k) =>
                              k.page === selectedRange.internalPage &&
                              k.number === num,
                          );
                          const verifyEnabled =
                            key?.verify_enabled !== false;
                          setCurrentAttemptId(attemptId);
                          setWasCorrectEntry(false);
                          setGradeResult({
                            attempt_id: attemptId,
                            is_correct: false,
                            student_answer: null,
                            correct_answer: key?.final_answer || "",
                            concept_tag: "",
                            error_tag: null,
                            feedback: "",
                            problem_description:
                              key?.problem_description || null,
                          });
                          setCurrentDiagramSvg(key?.diagram_svg || null);
                          router.push(
                            `/student/coach?attempt_id=${attemptId}&verify=${verifyEnabled}`,
                          );
                          return;
                        }
                        if (status === "coached" && attemptId) {
                          setCurrentAttemptId(attemptId);
                          const key = allKeys.find(
                            (k) =>
                              k.page === selectedRange.internalPage &&
                              k.number === num,
                          );
                          setGradeResult({
                            attempt_id: attemptId,
                            is_correct: false,
                            student_answer: null,
                            correct_answer: key?.final_answer || "",
                            concept_tag: "",
                            error_tag: null,
                            feedback: "",
                            problem_description:
                              key?.problem_description || "",
                          });
                          // If teacher rejected regen → use saved variant instead of generating new
                          const sv = savedVariants[problemKey];
                          if (sv) {
                            setVariantProblem({
                              display_text: sv.display_text,
                              correct_answer: sv.correct_answer,
                              difficulty_band: "medium",
                            });
                          } else {
                            setVariantProblem(null);
                          }
                          setVerifyWorkPhoto(null);
                          router.push("/student/verify");
                          return;
                        }
                      }}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${bgClass} ${borderClass} ${isLocked ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {t("numberLabel", { num })}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <Button
            onClick={() =>
              setSolvePhase(
                storedProblemDesc
                  ? SOLVE_PHASE.WORK_PHOTO
                  : SOLVE_PHASE.PROBLEM_PHOTO,
              )
            }
            disabled={
              !currentPage ||
              !currentNumber ||
              LOCKED_STATUSES.includes(
                problemStatuses[`${currentPage}_${currentNumber}`] as (typeof LOCKED_STATUSES)[number],
              )
            }
            size="lg"
            className="w-full rounded-xl py-6 text-lg font-semibold"
          >
            {tCommon("next")}
          </Button>
        </>
      )}

      {/* Phase 2: Problem photo */}
      {solvePhase === SOLVE_PHASE.PROBLEM_PHOTO && (
        <>
          <p className="text-center text-sm text-muted-foreground">
            {t("takePhoto")}
          </p>
          <input
            ref={problemFileRef}
            type="file"
            accept="image/*"
            onChange={handleProblemCapture}
            className="hidden"
          />
          {problemPreview ? (
            <div className="relative">
              <img
                src={problemPreview}
                alt={t("problemPhoto")}
                className="w-full rounded-xl border"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => problemFileRef.current?.click()}
                className="absolute right-2 top-2 rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                {t("reselect")}
              </Button>
            </div>
          ) : (
            <button
              onClick={() => problemFileRef.current?.click()}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors active:bg-muted"
            >
              <span className="text-3xl">📷</span>
              <span>{t("problemImageInput")}</span>
            </button>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setProblemPhoto(null);
                setSolvePhase(SOLVE_PHASE.INPUT);
              }}
              className="flex-1 rounded-xl"
            >
              {tCommon("back")}
            </Button>
            <Button
              onClick={() => setSolvePhase(SOLVE_PHASE.WORK_PHOTO)}
              disabled={!problemPhoto}
              className="flex-1 rounded-xl"
            >
              {tCommon("next")}
            </Button>
          </div>
        </>
      )}

      {/* Phase 3: Work photo + Direct answer */}
      {solvePhase === SOLVE_PHASE.WORK_PHOTO && (
        <>
          {/* Stored problem description from DB */}
          {storedProblemDesc && (
            <Card className="border-purple-200 bg-purple-50">
              <CardContent className="p-3">
                <p className="mb-2 text-xs font-medium text-purple-700">{t("problemLabel")}</p>
                <MathText as="p" className="text-sm font-medium leading-relaxed" diagramSvg={storedDiagramSvg} problemImageUrl={storedProblemImageUrl}>
                  {storedProblemDesc}
                </MathText>
              </CardContent>
            </Card>
          )}

          {/* Grading error banner with retry */}
          {gradingError && (
            <Alert variant="destructive">
              <AlertDescription>
                {gradingError}
                <Button
                  onClick={handleGrade}
                  disabled={!canGrade}
                  variant="destructive"
                  className="mt-2 w-full rounded-xl"
                >
                  {tCommon("retry")}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Direct answer input */}
          <div>
            <Label className="mb-1 text-muted-foreground">
              {t("directAnswer")}
            </Label>
            <Textarea
              value={directAnswer}
              onChange={(e) => setDirectAnswer(e.target.value)}
              placeholder={t("directAnswerPlaceholder")}
              rows={2}
              className="text-lg resize-y"
            />
          </div>

          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Separator className="flex-1" />
            <span>{tCommon("or")}</span>
            <Separator className="flex-1" />
          </div>

          {/* Photo capture */}
          <p className="text-center text-sm text-muted-foreground">
            {t("workImageInput")}
          </p>
          <input
            ref={workFileRef}
            type="file"
            accept="image/*"
            onChange={handleWorkCapture}
            className="hidden"
          />
          {workPreview ? (
            <div className="relative">
              <img
                src={workPreview}
                alt={t("workPhoto")}
                className="w-full rounded-xl border"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => workFileRef.current?.click()}
                className="absolute right-2 top-2 rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                {t("reselect")}
              </Button>
            </div>
          ) : (
            <button
              onClick={() => workFileRef.current?.click()}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors active:bg-muted"
            >
              <span className="text-3xl">📷</span>
              <span>{t("workImageInputLabel")}</span>
            </button>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setWorkPhoto(null);
                setDirectAnswer("");
                setSolvePhase(
                  storedProblemDesc
                    ? SOLVE_PHASE.INPUT
                    : SOLVE_PHASE.PROBLEM_PHOTO,
                );
              }}
              className="flex-1 rounded-xl"
            >
              {tCommon("back")}
            </Button>
            <Button
              onClick={handleGrade}
              disabled={!canGrade}
              className="flex-1 rounded-xl"
            >
              {t("grade")}
            </Button>
          </div>
        </>
      )}

      {/* Phase 4: Grading */}
      {solvePhase === SOLVE_PHASE.GRADING && (
        <div className="flex flex-col items-center gap-4 py-12">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            {t("grading")}{gradingElapsed > 0 && `(${gradingElapsed}${tCommon("seconds")})`}
          </p>
          {gradingElapsed * 1000 >= GRADING.SLOW_THRESHOLD_MS && (
            <p className="text-xs text-orange-600">
              {t("gradingSlow")}
            </p>
          )}
        </div>
      )}

      {/* Phase 5: Result */}
      {solvePhase === SOLVE_PHASE.RESULT && gradeResult && (
        <Card
          className={`border ${
            gradeResult.error_tag === "retake_needed"
              ? "border-yellow-200 bg-yellow-50"
              : gradeResult.is_correct
                ? "border-green-200 bg-green-50"
                : "border-red-200 bg-red-50"
          }`}
        >
          <CardContent className="space-y-3 p-5">
            {gradeResult.error_tag === "retake_needed" ? (
              /* Retake needed */
              <div className="space-y-3 text-center">
                <p className="text-2xl">📸</p>
                <p className="text-lg font-semibold text-yellow-700">
                  {t("retakeNeeded")}
                </p>
                <MathText as="p" className="text-sm text-muted-foreground">
                  {gradeResult.feedback}
                </MathText>
                <Button
                  onClick={() => {
                    setWorkPhoto(null);
                    setDirectAnswer("");
                    setGradeResult(null);
                    setSolvePhase(SOLVE_PHASE.WORK_PHOTO);
                  }}
                  className="w-full rounded-xl font-semibold"
                >
                  {t("retake")}
                </Button>
              </div>
            ) : gradeResult.is_correct ? (
              /* Correct */
              <div className="space-y-3 text-center">
                <p className="text-2xl">🎉</p>
                <p className="text-lg font-semibold text-green-700">
                  {t("correctFeedback")}
                </p>
                {gradeResult.student_answer && (
                  <p className="text-sm text-muted-foreground">
                    {tCommon("myAnswer")}{formatAnswer(gradeResult.student_answer)}
                  </p>
                )}
                <div className="space-y-2">
                  <Button
                    onClick={handleNextProblem}
                    className="w-full rounded-xl font-semibold"
                  >
                    {t("nextProblem")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => startCoaching(true)}
                    className="w-full rounded-xl"
                  >
                    {t("voiceCoachingOptional")}
                  </Button>
                </div>
              </div>
            ) : (
              /* Wrong */
              <div className="space-y-3">
                <p className="text-center text-lg font-semibold text-red-700">
                  {t("wrongFeedback")}
                </p>

                {gradeResult.student_answer && (
                  <div className="px-2 text-sm">
                    <span className="text-muted-foreground">{tCommon("myAnswer")}</span>
                    <span className="font-mono font-semibold text-red-600">
                      {formatAnswer(gradeResult.student_answer)}
                    </span>
                  </div>
                )}

                {/* Error tag badge */}
                {gradeResult.error_tag &&
                  gradeResult.error_tag !== "none" && (
                    <div className="flex justify-center">
                      <Badge variant="destructive">
                        {errorTagLabel(gradeResult.error_tag)}
                      </Badge>
                    </div>
                  )}

                {/* Feedback */}
                <MathText as="p" className="text-sm text-muted-foreground">
                  {gradeResult.feedback}
                </MathText>

                {/* Actions: coaching + dispute */}
                <Button
                  onClick={() => startCoaching(false)}
                  className="w-full rounded-xl font-semibold"
                >
                  {t("voiceCoachingStart")}
                </Button>
                {isSoloStudy && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground"
                    onClick={async () => {
                      try {
                        await markMastered(workbookId || "", currentPage, currentNumber);
                        const key = `${currentPage}_${currentNumber}`;
                        setProblemStatuses((prev) => ({ ...prev, [key]: "mastered" }));
                      } catch { /* */ }
                      await handleNextProblem();
                    }}
                  >
                    {t("skipCoaching")}
                  </Button>
                )}
                {!isSoloStudy && (
                  disputeSubmitted ? (
                    <div className="space-y-2">
                      <p className="text-center text-xs text-orange-600">
                        {t("disputeSubmitted")}
                      </p>
                      <Button
                        onClick={handleNextProblem}
                        variant="outline"
                        className="w-full rounded-xl"
                      >
                        {t("nextProblemTo")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDispute}
                      disabled={disputeSubmitting}
                      className="w-full text-xs text-orange-600 hover:text-orange-700"
                    >
                      {disputeSubmitting ? t("submitting") : t("disputeButton")}
                    </Button>
                  )
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
