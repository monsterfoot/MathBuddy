"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getDueCards,
  generateVariant,
  gradeVerification,
  submitReview,
  createDispute,
  createRegenRequest,
  type MistakeCard,
  type VariantResult,
  type VerifyResult,
  type ReviewResult,
} from "@/lib/api";
import {
  GRADING,
  REVIEW_PHASE,
} from "@/lib/constants";
import { useTranslations } from "next-intl";
import { useConceptTagLabel, useErrorTagLabel } from "@/lib/i18n-labels";
import { useAppStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImageCropper } from "@/components/ImageCropper";
import { MathText } from "@/components/MathText";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";

type ReviewPhase = (typeof REVIEW_PHASE)[keyof typeof REVIEW_PHASE];

export default function ReviewPage() {
  const router = useRouter();
  const t = useTranslations("review");
  const tCommon = useTranslations("common");
  const conceptTagLabel = useConceptTagLabel();
  const errorTagLabel = useErrorTagLabel();

  // Zustand store — persists across coach navigation
  const reviewCards = useAppStore((s) => s.reviewCards);
  const setReviewCards = useAppStore((s) => s.setReviewCards);
  const reviewCardIdx = useAppStore((s) => s.reviewCardIdx);
  const setReviewCardIdx = useAppStore((s) => s.setReviewCardIdx);
  const reviewSm2Done = useAppStore((s) => s.reviewSm2Done);
  const setReviewSm2Done = useAppStore((s) => s.setReviewSm2Done);
  const reviewCorrectCount = useAppStore((s) => s.reviewCorrectCount);
  const setReviewCorrectCount = useAppStore((s) => s.setReviewCorrectCount);
  const reviewFirstResult = useAppStore((s) => s.reviewFirstResult);
  const setReviewFirstResult = useAppStore((s) => s.setReviewFirstResult);
  const reviewFromCoaching = useAppStore((s) => s.reviewFromCoaching);
  const setReviewFromCoaching = useAppStore((s) => s.setReviewFromCoaching);
  const clearReviewSession = useAppStore((s) => s.clearReviewSession);
  const isSoloStudy = useAppStore((s) => s.isSoloStudy);

  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<ReviewPhase>(REVIEW_PHASE.LIST);

  // Variant state
  const [variant, setVariant] = useState<VariantResult | null>(null);
  const [variantError, setVariantError] = useState<string | null>(null);

  // Answer state
  const [answer, setAnswer] = useState("");
  const [workPhoto, setWorkPhoto] = useState<File | null>(null);

  // Crop state
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Grading state
  const [gradeResult, setGradeResult] = useState<VerifyResult | null>(null);
  const [gradingError, setGradingError] = useState<string | null>(null);
  const [gradingElapsed, setGradingElapsed] = useState(0);
  const gradingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopGradingTimer = () => {
    if (gradingTimerRef.current) {
      clearInterval(gradingTimerRef.current);
      gradingTimerRef.current = null;
    }
  };

  // SM-2 result display
  const [sm2Result, setSm2Result] = useState<ReviewResult | null>(null);

  // Dispute state
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeSubmitted, setDisputeSubmitted] = useState(false);

  // Regen request state
  const [regenSubmitting, setRegenSubmitting] = useState(false);
  const [regenSubmitted, setRegenSubmitted] = useState(false);

  const currentCard: MistakeCard | null = reviewCards[reviewCardIdx] ?? null;

  // Load due cards on mount (but skip if returning from coaching)
  useEffect(() => {
    if (reviewFromCoaching && reviewCards.length > 0) {
      // Returning from coaching — generate new variant for current card
      setReviewFromCoaching(false);
      const card = reviewCards[reviewCardIdx];
      if (card) {
        loadVariant(card);
      }
      setLoading(false);
      return;
    }

    // Fresh load or no session
    if (reviewCards.length > 0 && !reviewFromCoaching) {
      // Already have cards loaded (e.g. navigated back)
      setLoading(false);
      return;
    }

    getDueCards()
      .then((res) => {
        setReviewCards(res.cards);
      })
      .catch(() => setReviewCards([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const workPreview = workPhoto ? URL.createObjectURL(workPhoto) : null;

  const startReview = () => {
    setReviewCardIdx(0);
    setReviewCorrectCount(0);
    setReviewSm2Done(false);
    setReviewFirstResult(null);
    setSm2Result(null);
    loadVariant(reviewCards[0]);
  };

  const loadVariant = (card: MistakeCard) => {
    setPhase(REVIEW_PHASE.LOADING_VARIANT);
    setVariant(null);
    setVariantError(null);
    resetAnswerState();

    generateVariant(
      card.difficulty_band || "medium",
      card.page ?? 0,
      card.number ?? 0,
      card.problem_description || "",
      card.image_dependent ?? false,
      card.correct_answer ?? "",
      card.workbook_id ?? "",
    )
      .then((v) => {
        setVariant(v);
        setPhase(REVIEW_PHASE.ANSWER);
      })
      .catch((err) => {
        setVariantError(
          err instanceof Error ? err.message : t("variantLoadFailed")
        );
      });
  };

  const resetAnswerState = () => {
    setAnswer("");
    setWorkPhoto(null);
    setGradeResult(null);
    setGradingError(null);
    setSm2Result(null);
    setDisputeSubmitting(false);
    setDisputeSubmitted(false);
    setRegenSubmitting(false);
    setRegenSubmitted(false);
  };

  // --- Image capture ---
  const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropSrc(URL.createObjectURL(file));
  };

  const handleCropDone = (croppedFile: File) => {
    setWorkPhoto(croppedFile);
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const canGrade = !!workPhoto || !!answer.trim();

  // --- Grade using gradeVerification ---
  const handleGrade = async () => {
    if (!currentCard || !variant || !canGrade) return;
    setPhase(REVIEW_PHASE.GRADING);
    setGradingError(null);
    setGradingElapsed(0);
    const t0 = Date.now();
    gradingTimerRef.current = setInterval(() => {
      setGradingElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 1000);

    try {
      const res = await gradeVerification(
        variant.correct_answer,
        currentCard.concept_tag,
        "", // original_attempt_id — not needed for review
        currentCard.workbook_id || "",
        currentCard.page ?? 0,
        currentCard.number ?? 0,
        workPhoto || null,
        answer.trim() || null,
      );
      setGradeResult(res);

      // SM-2 update on first attempt only
      if (!reviewSm2Done) {
        const qualityScore = res.is_correct ? 5 : 2;
        const sm2Res = await submitReview(
          currentCard.card_id,
          res.is_correct,
          qualityScore,
        );
        setSm2Result(sm2Res);
        setReviewFirstResult(sm2Res);
        setReviewSm2Done(true);
        if (res.is_correct) {
          setReviewCorrectCount(reviewCorrectCount + 1);
        }
      }

      setPhase(REVIEW_PHASE.RESULT);
    } catch (err) {
      setGradingError(
        err instanceof Error ? err.message : t("gradingError")
      );
      setPhase(REVIEW_PHASE.ANSWER);
    } finally {
      stopGradingTimer();
    }
  };

  // --- Navigate to coaching ---
  const handleGoToCoaching = () => {
    if (!gradeResult) return;
    // Set store state for coach page to know we came from review
    useAppStore.getState().setLastVerifyContext({
      variant_display_text: variant?.display_text || "",
      variant_correct_answer: variant?.correct_answer || "",
      variant_student_answer: gradeResult.student_answer || "",
    });

    const attemptId = gradeResult.attempt_id;
    router.push(
      `/student/coach?attempt_id=${attemptId}&retry=true&from=review`
    );
  };

  const handleDispute = async () => {
    if (!gradeResult || !currentCard) return;
    setDisputeSubmitting(true);
    try {
      await createDispute(
        gradeResult.attempt_id || "",
        currentCard.workbook_id || "",
        currentCard.page ?? 0,
        currentCard.number ?? 0,
        gradeResult.student_answer || "",
        gradeResult.correct_answer || "",
        variant?.display_text || "",
        "review",
      );
      setDisputeSubmitted(true);
    } catch {
      // silently fail
    } finally {
      setDisputeSubmitting(false);
    }
  };

  // --- Next card ---
  const handleNext = () => {
    const nextIdx = reviewCardIdx + 1;
    if (nextIdx >= reviewCards.length) {
      setPhase(REVIEW_PHASE.DONE);
    } else {
      setReviewCardIdx(nextIdx);
      setReviewSm2Done(false);
      setReviewFirstResult(null);
      setSm2Result(null);
      loadVariant(reviewCards[nextIdx]);
    }
  };

  const formatDueIn = (dateStr: string) => {
    const due = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.round((due.getTime() - now.getTime()) / 86_400_000);
    if (diffDays <= 0) return t("today");
    if (diffDays === 1) return t("tomorrow");
    return t("daysLater", { days: diffDays });
  };

  /** Display "choice:3" as localized number label, otherwise as-is. */
  const formatAnswer = (raw: string | null | undefined) => {
    if (!raw) return "—";
    const m = raw.match(/^choice:(\d)$/);
    return m ? tCommon("numberLabel", { num: m[1] }) : raw;
  };

  // --- Loading ---
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {tCommon("loading")}
      </div>
    );
  }

  // --- No cards ---
  if (reviewCards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 pb-20 text-center">
        <span className="text-4xl">🎉</span>
        <p className="text-lg font-medium text-muted-foreground">
          {t("noReviewToday")}
        </p>
        <p className="text-sm text-muted-foreground/70">{t("checkTomorrow")}</p>
      </div>
    );
  }

  // --- LIST phase ---
  if (phase === REVIEW_PHASE.LIST) {
    return (
      <div className="mx-auto max-w-sm space-y-4 pb-20">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t("todayReview")}</h3>
          <Badge variant="secondary" className="text-sm">
            {reviewCards.length}{t("cards")}
          </Badge>
        </div>

        <div className="space-y-3">
          {reviewCards.map((card) => (
            <Card key={card.card_id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">
                      {conceptTagLabel(card.concept_tag)}
                    </span>
                    {card.page != null && card.number != null && (
                      <p className="text-xs text-muted-foreground">
                        {tCommon("pageNumber", { page: card.page, number: card.number })}
                      </p>
                    )}
                    {card.problem_description && (
                      <MathText as="p" className="mt-1 truncate text-xs text-muted-foreground">
                        {card.problem_description}
                      </MathText>
                    )}
                  </div>
                  <Badge variant="outline" className="ml-2 shrink-0 text-xs">
                    {card.repetitions}{t("reviewCount")}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button onClick={startReview} className="w-full rounded-xl font-semibold">
          {t("startReview")}
        </Button>
      </div>
    );
  }

  // --- LOADING_VARIANT phase ---
  if (phase === REVIEW_PHASE.LOADING_VARIANT) {
    return (
      <div className="mx-auto max-w-sm space-y-6 pb-20">
        <ProgressHeader current={reviewCardIdx + 1} total={reviewCards.length} />
        {variantError ? (
          <div className="space-y-2">
            <Alert variant="destructive">
              <AlertDescription>{variantError}</AlertDescription>
            </Alert>
            <Button
              variant="destructive"
              onClick={() => currentCard && loadVariant(currentCard)}
              className="w-full rounded-xl"
            >
              {tCommon("retry")}
            </Button>
            <Button
              variant="outline"
              onClick={handleNext}
              className="w-full rounded-xl"
            >
              {t("skip")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {t("generatingProblem")}
            </p>
          </div>
        )}
      </div>
    );
  }

  // --- ANSWER phase ---
  if (phase === REVIEW_PHASE.ANSWER) {
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

        <ProgressHeader current={reviewCardIdx + 1} total={reviewCards.length} />

        {/* Variant problem */}
        {variant && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs">
                  {conceptTagLabel(currentCard?.concept_tag ?? "")}
                </Badge>
                <span className="text-xs text-muted-foreground">{t("reviewProblem")}</span>
              </div>
              <MathText
                as="p"
                className="text-lg font-medium leading-relaxed"
                diagramSvg={variant.diagram_svg}
                problemImageUrl={currentCard?.problem_image_url}
              >
                {variant.display_text}
              </MathText>
              {/* Regen request button — hidden in solo mode */}
              {!isSoloStudy && (
                regenSubmitted ? (
                  <p className="text-center text-xs text-purple-600">
                    {t("regenSubmitted")}
                  </p>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={regenSubmitting}
                    onClick={async () => {
                      if (!currentCard) return;
                      setRegenSubmitting(true);
                      try {
                        await createRegenRequest(
                          currentCard.card_id,
                          currentCard.workbook_id || "",
                          currentCard.page ?? 0,
                          currentCard.number ?? 0,
                          variant.display_text,
                          variant.correct_answer,
                          currentCard.problem_description || "",
                        );
                        setRegenSubmitted(true);
                      } catch {
                        // silently fail
                      }
                      setRegenSubmitting(false);
                    }}
                    className="w-full text-xs text-purple-600 hover:text-purple-700"
                  >
                    {regenSubmitting ? t("regenSubmitting") : t("regenButton")}
                  </Button>
                )
              )}
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
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={t("directAnswerPlaceholder")}
            rows={2}
            className="text-lg resize-y"
            autoFocus
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
            onClick={handleNext}
          >
            {t("skipVerify")}
          </Button>
        )}
      </div>
    );
  }

  // --- GRADING phase ---
  if (phase === REVIEW_PHASE.GRADING) {
    return (
      <div className="mx-auto max-w-sm space-y-6 pb-20">
        <ProgressHeader current={reviewCardIdx + 1} total={reviewCards.length} />
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
      </div>
    );
  }

  // --- RESULT phase ---
  if (phase === REVIEW_PHASE.RESULT && gradeResult) {
    const isFirstAttempt = !!sm2Result;
    const isRetryAttempt = !isFirstAttempt;

    return (
      <div className="mx-auto max-w-sm space-y-6 pb-20">
        <ProgressHeader current={reviewCardIdx + 1} total={reviewCards.length} />

        <Card
          className={`border ${
            gradeResult.is_correct
              ? "border-green-200 bg-green-50"
              : "border-red-200 bg-red-50"
          }`}
        >
          <CardContent className="space-y-3 p-5">
            {gradeResult.is_correct ? (
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

                {/* Show next review schedule only for first attempt */}
                {sm2Result && (
                  <div className="rounded-lg bg-white/50 p-3 text-sm">
                    <p className="text-muted-foreground">
                      {t("nextReview")}
                      <span className="font-medium text-foreground">
                        {formatDueIn(sm2Result.next_due_at)}
                      </span>
                    </p>
                  </div>
                )}

                {isRetryAttempt && (
                  <p className="text-xs text-muted-foreground">
                    {t("retryNote")}
                  </p>
                )}
              </div>
            ) : (
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
                {gradeResult.error_tag &&
                  gradeResult.error_tag !== "none" && (
                    <div className="flex justify-center">
                      <Badge variant="destructive">
                        {errorTagLabel(gradeResult.error_tag)}
                      </Badge>
                    </div>
                  )}
                <MathText as="p" className="text-sm text-muted-foreground">
                  {gradeResult.feedback}
                </MathText>

                {/* Show next review schedule for first wrong attempt */}
                {sm2Result && (
                  <div className="rounded-lg bg-white/50 p-3 text-sm">
                    <p className="text-muted-foreground">
                      {t("nextReview")}
                      <span className="font-medium text-foreground">
                        {formatDueIn(sm2Result.next_due_at)}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action buttons */}
        <div className="space-y-2">
          {gradeResult.is_correct ? (
            <Button
              onClick={handleNext}
              className="w-full rounded-xl font-semibold"
            >
              {reviewCardIdx + 1 < reviewCards.length ? t("nextCard") : tCommon("done")}
            </Button>
          ) : (
            <>
              <Button
                onClick={handleGoToCoaching}
                className="w-full rounded-xl font-semibold"
              >
                {t("getCoaching")}
              </Button>
              {isSoloStudy && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  onClick={handleNext}
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
                      onClick={handleNext}
                      variant="outline"
                      className="w-full rounded-xl"
                    >
                      {reviewCardIdx + 1 < reviewCards.length ? t("nextCard") : tCommon("done")}
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
            </>
          )}
        </div>
      </div>
    );
  }

  // --- DONE phase ---
  if (phase === REVIEW_PHASE.DONE) {
    return (
      <div className="mx-auto max-w-sm space-y-6 pb-20">
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <span className="text-5xl">🏆</span>
          <h3 className="text-xl font-semibold">{t("reviewComplete")}</h3>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t("totalReviewed", { count: reviewCards.length })}</p>
            <p>
              <span className="font-semibold text-green-600">
                {t("correctCount", { count: reviewCorrectCount })}
              </span>
              {" / "}
              <span className="font-semibold text-red-600">
                {t("wrongCount", { count: reviewCards.length - reviewCorrectCount })}
              </span>
            </p>
          </div>
        </div>

        <Button
          onClick={() => {
            clearReviewSession();
            setPhase(REVIEW_PHASE.LIST);
            setLoading(true);
            getDueCards()
              .then((res) => setReviewCards(res.cards))
              .catch(() => setReviewCards([]))
              .finally(() => setLoading(false));
          }}
          variant="outline"
          className="w-full rounded-xl"
        >
          {t("backToList")}
        </Button>
      </div>
    );
  }

  return null;
}

/** Small header showing review progress. */
function ProgressHeader({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const t = useTranslations("review");
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-lg font-semibold">{t("title")}</h3>
      <span className="text-sm text-muted-foreground">
        {current} / {total}
      </span>
    </div>
  );
}
