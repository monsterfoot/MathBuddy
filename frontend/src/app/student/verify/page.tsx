"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { generateVariant, gradeVerification, getNextProblem, createDispute, createRegenRequest, markMastered } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { GRADING, VERIFY_PHASE } from "@/lib/constants";
import { useTranslations } from "next-intl";
import { useErrorTagLabel } from "@/lib/i18n-labels";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ImageCropper } from "@/components/ImageCropper";
import { MathText } from "@/components/MathText";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";

export default function VerifyPage() {
  const router = useRouter();
  const workbookId = useAppStore((s) => s.workbookId);
  const gradeResult = useAppStore((s) => s.gradeResult);
  const currentPage = useAppStore((s) => s.currentPage);
  const currentNumber = useAppStore((s) => s.currentNumber);
  const currentAttemptId = useAppStore((s) => s.currentAttemptId);

  const variantProblem = useAppStore((s) => s.variantProblem);
  const setVariantProblem = useAppStore((s) => s.setVariantProblem);
  const verifyPhase = useAppStore((s) => s.verifyPhase);
  const setVerifyPhase = useAppStore((s) => s.setVerifyPhase);
  const verifyWorkPhoto = useAppStore((s) => s.verifyWorkPhoto);
  const setVerifyWorkPhoto = useAppStore((s) => s.setVerifyWorkPhoto);
  const setCurrentProblem = useAppStore((s) => s.setCurrentProblem);
  const resetToSolve = useAppStore((s) => s.resetToSolve);
  const isSoloStudy = useAppStore((s) => s.isSoloStudy);
  const setWasCorrectEntry = useAppStore((s) => s.setWasCorrectEntry);
  const setLastVerifyContext = useAppStore((s) => s.setLastVerifyContext);

  const t = useTranslations("verify");
  const tCommon = useTranslations("common");
  const tReview = useTranslations("review");
  const errorTagLabel = useErrorTagLabel();

  const [verifyResult, setVerifyResult] = useState<{
    is_correct: boolean;
    student_answer: string | null;
    correct_answer: string;
    error_tag: string | null;
    feedback: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gradingError, setGradingError] = useState<string | null>(null);
  const [directAnswer, setDirectAnswer] = useState("");
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeSubmitted, setDisputeSubmitted] = useState(false);
  const [regenSubmitting, setRegenSubmitting] = useState(false);
  const [regenSubmitted, setRegenSubmitted] = useState(false);

  // Crop state
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  // Grading elapsed timer
  const [gradingElapsed, setGradingElapsed] = useState(0);
  const gradingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopGradingTimer = () => {
    if (gradingTimerRef.current) {
      clearInterval(gradingTimerRef.current);
      gradingTimerRef.current = null;
    }
  };

  const fileRef = useRef<HTMLInputElement>(null);

  // Load variant on mount
  useEffect(() => {
    if (variantProblem) {
      setVerifyPhase(VERIFY_PHASE.DISPLAY);
      return;
    }

    let cancelled = false;
    setVerifyPhase(VERIFY_PHASE.LOADING);

    generateVariant(
        "medium",
        currentPage,
        currentNumber,
        gradeResult?.problem_description || "",
        false,
        "",
        workbookId || "",
        currentAttemptId || "",
      )
      .then((v) => {
        if (cancelled) return;
        setVariantProblem(v);
        setVerifyPhase(VERIFY_PHASE.DISPLAY);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : t("loadFailed")
        );
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const workPreview = verifyWorkPhoto
    ? URL.createObjectURL(verifyWorkPhoto)
    : null;

  const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropSrc(URL.createObjectURL(file));
  };

  const handleCropDone = (croppedFile: File) => {
    setVerifyWorkPhoto(croppedFile);
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const canGrade = !!verifyWorkPhoto || !!directAnswer.trim();

  const handleGrade = async () => {
    if (!variantProblem || !canGrade) return;
    setVerifyPhase(VERIFY_PHASE.GRADING);
    setGradingError(null);
    setGradingElapsed(0);
    const t0 = Date.now();
    gradingTimerRef.current = setInterval(() => {
      setGradingElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    try {
      const res = await gradeVerification(
        variantProblem.correct_answer,
        "",
        currentAttemptId || "",
        workbookId || "demo",
        currentPage,
        currentNumber,
        verifyWorkPhoto || null,
        directAnswer.trim() || null,
      );
      setVerifyResult(res);
      setVerifyPhase(VERIFY_PHASE.RESULT);
    } catch (err) {
      setGradingError(err instanceof Error ? err.message : t("gradingError"));
      setVerifyPhase(VERIFY_PHASE.PHOTO);
    } finally {
      stopGradingTimer();
    }
  };

  const handleCorrect = async () => {
    try {
      const next = await getNextProblem(
        workbookId || "demo",
        currentPage,
        currentNumber,
      );
      if (next.page != null && next.number != null) {
        setCurrentProblem(next.page, next.number);
      } else {
        alert(t("allComplete"));
      }
    } catch {
      // stay on current
    }
    resetToSolve();
    router.push("/student/solve");
  };

  const handleWrongRetry = () => {
    // Save variant context for retry coaching
    if (variantProblem) {
      setLastVerifyContext({
        variant_display_text: variantProblem.display_text,
        variant_correct_answer: variantProblem.correct_answer,
        variant_student_answer: verifyResult?.student_answer || "",
      });
    }

    // Go back to coaching for the same problem, with retry flag
    setWasCorrectEntry(false);
    setVariantProblem(null); // clear so next verify generates a new one
    setVerifyWorkPhoto(null);
    if (currentAttemptId) {
      router.push(`/student/coach?attempt_id=${currentAttemptId}&retry=true`);
    }
  };

  const handleDispute = async () => {
    if (!verifyResult || !workbookId) return;
    setDisputeSubmitting(true);
    try {
      await createDispute(
        currentAttemptId || "",
        workbookId,
        currentPage,
        currentNumber,
        verifyResult.student_answer || "",
        verifyResult.correct_answer || "",
        variantProblem?.display_text || "",
        "verify",
      );
      setDisputeSubmitted(true);
    } catch {
      // silently fail
    } finally {
      setDisputeSubmitting(false);
    }
  };

  const handleDisputeNext = async () => {
    try {
      const next = await getNextProblem(
        workbookId || "demo",
        currentPage,
        currentNumber,
      );
      if (next.page != null && next.number != null) {
        setCurrentProblem(next.page, next.number);
      } else {
        alert(t("allComplete"));
      }
    } catch {
      // stay on current
    }
    resetToSolve();
    router.push("/student/solve");
  };

  // Loading state
  if (verifyPhase === VERIFY_PHASE.LOADING) {
    return (
      <div className="mx-auto max-w-sm space-y-6 pb-20">
        <h3 className="text-lg font-semibold">{t("title")}</h3>
        {error ? (
          <div className="space-y-2">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button
              variant="destructive"
              onClick={() => {
                setError(null);
                setVerifyPhase(VERIFY_PHASE.LOADING);
                generateVariant(
                  "medium",
                  currentPage,
                  currentNumber,
                  gradeResult?.problem_description || "",
                  false,
                  "",
                  workbookId || "",
                  currentAttemptId || "",
                )
                  .then((v) => {
                    setVariantProblem(v);
                    setVerifyPhase(VERIFY_PHASE.DISPLAY);
                  })
                  .catch((err) => {
                    setError(
                      err instanceof Error
                        ? err.message
                        : t("loadFailed")
                    );
                  });
              }}
              className="w-full rounded-xl"
            >
              {tCommon("retry")}
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/student/solve")}
              className="w-full rounded-xl"
            >
              {tCommon("goBack")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {t("generating")}
            </p>
          </div>
        )}
      </div>
    );
  }

  /** Display "choice:3" as localized number label, otherwise as-is. */
  const formatAnswer = (raw: string | null | undefined) => {
    if (!raw) return "—";
    const m = raw.match(/^choice:(\d)$/);
    return m ? tCommon("numberLabel", { num: m[1] }) : raw;
  };

  return (
    <div className="mx-auto max-w-sm space-y-6 pb-20">
      {/* Image cropper overlay */}
      {cropSrc && (
        <ImageCropper
          imageSrc={cropSrc}
          onCropDone={handleCropDone}
          onCancel={handleCropCancel}
        />
      )}

      <h3 className="text-lg font-semibold">{t("title")}</h3>

      {/* Variant problem display */}
      {variantProblem && verifyPhase !== VERIFY_PHASE.RESULT && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t("sameTypeVerify")}
              </span>
              {!isSoloStudy && (
                regenSubmitted ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-600">{tReview("regenSubmitted")}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px]"
                      onClick={async () => {
                        try {
                          const next = await getNextProblem(
                            workbookId || "demo",
                            currentPage,
                            currentNumber,
                          );
                          if (next.page != null && next.number != null) {
                            setCurrentProblem(next.page, next.number);
                          } else {
                            alert(t("allComplete"));
                          }
                        } catch { /* */ }
                        resetToSolve();
                        router.push("/student/solve");
                      }}
                    >
                      {t("nextProblem")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] text-orange-600 hover:text-orange-700"
                    disabled={regenSubmitting}
                    onClick={async () => {
                      setRegenSubmitting(true);
                      try {
                        await createRegenRequest(
                          "",
                          workbookId || "",
                          currentPage,
                          currentNumber,
                          variantProblem.display_text,
                          variantProblem.correct_answer,
                          gradeResult?.problem_description || "",
                        );
                        setRegenSubmitted(true);
                      } catch { /* */ }
                      setRegenSubmitting(false);
                    }}
                  >
                    {regenSubmitting ? tReview("regenSubmitting") : tReview("regenButton")}
                  </Button>
                )
              )}
            </div>
            <MathText as="p" className="text-lg font-medium leading-relaxed" diagramSvg={variantProblem.diagram_svg}>
              {variantProblem.display_text}
            </MathText>
          </CardContent>
        </Card>
      )}

      {/* Answer input + Photo capture */}
      {!regenSubmitted && (verifyPhase === VERIFY_PHASE.DISPLAY ||
        verifyPhase === VERIFY_PHASE.PHOTO) && (
        <>
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
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleCapture}
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
                onClick={() => fileRef.current?.click()}
                className="absolute right-2 top-2 rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                {t("reselect")}
              </Button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors active:bg-muted"
            >
              <span className="text-3xl">📷</span>
              <span>{t("workImageInputLabel")}</span>
            </button>
          )}

          <Button
            onClick={handleGrade}
            disabled={!canGrade}
            className="w-full rounded-xl font-semibold"
          >
            {t("grade")}
          </Button>
          {isSoloStudy && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground"
              onClick={async () => {
                try {
                  await markMastered(workbookId || "", currentPage, currentNumber);
                } catch { /* */ }
                resetToSolve();
                try {
                  const next = await getNextProblem(workbookId || "demo", currentPage, currentNumber);
                  if (next.page != null && next.number != null) {
                    setCurrentProblem(next.page, next.number);
                  } else {
                    alert(t("allComplete"));
                  }
                } catch { /* */ }
                router.push("/student/solve");
              }}
            >
              {t("skipVerify")}
            </Button>
          )}
        </>
      )}

      {/* Grading */}
      {verifyPhase === VERIFY_PHASE.GRADING && (
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

      {/* Result */}
      {verifyPhase === VERIFY_PHASE.RESULT && verifyResult && (
        <Card
          className={`border ${
            verifyResult.is_correct
              ? "border-green-200 bg-green-50"
              : "border-red-200 bg-red-50"
          }`}
        >
          <CardContent className="space-y-3 p-5">
            {verifyResult.is_correct ? (
              <div className="space-y-3 text-center">
                <p className="text-2xl">🎉</p>
                <p className="text-lg font-semibold text-green-700">
                  {t("correctFeedback")}
                </p>
                {verifyResult.student_answer && (
                  <p className="text-sm text-muted-foreground">
                    {tCommon("myAnswer")}{formatAnswer(verifyResult.student_answer)}
                  </p>
                )}
                <div className="space-y-2">
                  <Button
                    onClick={handleCorrect}
                    className="w-full rounded-xl font-semibold"
                  >
                    {t("nextProblem")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setWasCorrectEntry(true);
                      if (currentAttemptId) {
                        router.push(`/student/coach?attempt_id=${currentAttemptId}`);
                      }
                    }}
                    className="w-full rounded-xl"
                  >
                    {t("voiceCoachingOptional")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-center text-lg font-semibold text-red-700">
                  {t("wrongFeedback")}
                </p>
                {verifyResult.student_answer && (
                  <div className="px-2 text-sm">
                    <span className="text-muted-foreground">{tCommon("myAnswer")}</span>
                    <span className="font-mono font-semibold text-red-600">
                      {formatAnswer(verifyResult.student_answer)}
                    </span>
                  </div>
                )}
                {verifyResult.error_tag &&
                  verifyResult.error_tag !== "none" && (
                    <div className="flex justify-center">
                      <Badge variant="destructive">
                        {errorTagLabel(verifyResult.error_tag)}
                      </Badge>
                    </div>
                  )}
                <MathText as="p" className="text-sm text-muted-foreground">
                  {verifyResult.feedback}
                </MathText>
                <Button
                  onClick={handleWrongRetry}
                  className="w-full rounded-xl font-semibold"
                >
                  {t("retryCoaching")}
                </Button>
                {!isSoloStudy && (
                  disputeSubmitted ? (
                    <div className="space-y-2">
                      <p className="text-center text-xs text-orange-600">
                        {t("disputeSubmitted")}
                      </p>
                      <Button
                        onClick={handleDisputeNext}
                        variant="outline"
                        className="w-full rounded-xl"
                      >
                        {t("nextProblem")}
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
