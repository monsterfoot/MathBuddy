"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useAudioSession, type AgentState } from "@/hooks/useAudioSession";
import { useAppStore } from "@/lib/store";
import { getNextProblem, markCoached, markMastered } from "@/lib/api";
import { COACHING, RMS_VIS } from "@/lib/constants";
import { useTranslations } from "next-intl";
import { useErrorTagLabel, useAgentStateLabel } from "@/lib/i18n-labels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MathText } from "@/components/MathText";

/* ------------------------------------------------------------------ */
/*  RMS Audio Level Bars — renders via rAF to avoid React re-renders  */
/* ------------------------------------------------------------------ */
function RmsLevelBars({ rmsRef }: { rmsRef: React.RefObject<number> }) {
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf: number;
    const animate = () => {
      if (barsRef.current) {
        const rms = rmsRef.current ?? 0;
        const ratio = Math.min(rms / RMS_VIS.MAX_RMS, 1);
        const bars = barsRef.current.children;
        for (let i = 0; i < bars.length; i++) {
          // Each bar has a slightly different phase for visual variety
          const phase = Math.sin(Date.now() / 120 + i * 1.2);
          const h =
            RMS_VIS.MIN_BAR_HEIGHT +
            ratio * (RMS_VIS.MAX_BAR_HEIGHT - RMS_VIS.MIN_BAR_HEIGHT) *
            (0.4 + 0.6 * Math.abs(phase));
          (bars[i] as HTMLElement).style.height = `${h}px`;
        }
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [rmsRef]);

  return (
    <div ref={barsRef} className="flex items-end gap-0.5">
      {Array.from({ length: RMS_VIS.BAR_COUNT }).map((_, i) => (
        <div
          key={i}
          className="w-1 rounded-full bg-green-500 transition-[height] duration-75"
          style={{ height: `${RMS_VIS.MIN_BAR_HEIGHT}px` }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent State Indicator                                             */
/* ------------------------------------------------------------------ */
function AgentStateIndicator({ state }: { state: AgentState }) {
  const agentStateLabel = useAgentStateLabel();

  if (state === "listening") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
        </span>
        <span className="text-xs font-medium text-green-600">
          {agentStateLabel("listening")}
        </span>
      </div>
    );
  }

  if (state === "thinking") {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex gap-0.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-amber-500 [animation-delay:0ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-amber-500 [animation-delay:150ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-amber-500 [animation-delay:300ms]" />
        </div>
        <span className="text-xs font-medium text-amber-600">
          {agentStateLabel("thinking")}
        </span>
      </div>
    );
  }

  if (state === "speaking") {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex items-end gap-0.5">
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              className="w-1 animate-pulse rounded-full bg-blue-500"
              style={{
                height: `${6 + i * 3}px`,
                animationDelay: `${i * 100}ms`,
              }}
            />
          ))}
        </div>
        <span className="text-xs font-medium text-blue-600">
          {agentStateLabel("speaking")}
        </span>
      </div>
    );
  }

  // idle
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex h-2.5 w-2.5 rounded-full bg-gray-300" />
      <span className="text-xs text-muted-foreground">
        {agentStateLabel("idle")}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Large Centered State Indicator                                     */
/* ------------------------------------------------------------------ */
function LargeStateIndicator({ state }: { state: AgentState }) {
  const agentStateLabel = useAgentStateLabel();

  if (state === "listening") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-green-50/90 px-8 py-5 shadow-md backdrop-blur-sm">
        <span className="relative flex h-10 w-10">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
          <span className="relative inline-flex h-10 w-10 rounded-full bg-green-500" />
        </span>
        <span className="text-base font-semibold text-green-700">
          {agentStateLabel("listening")}
        </span>
      </div>
    );
  }

  if (state === "thinking") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-amber-50/90 px-8 py-5 shadow-md backdrop-blur-sm">
        <div className="flex gap-1.5">
          <span className="h-4 w-4 animate-bounce rounded-full bg-amber-500 [animation-delay:0ms]" />
          <span className="h-4 w-4 animate-bounce rounded-full bg-amber-500 [animation-delay:150ms]" />
          <span className="h-4 w-4 animate-bounce rounded-full bg-amber-500 [animation-delay:300ms]" />
        </div>
        <span className="text-base font-semibold text-amber-700">
          {agentStateLabel("thinking")}
        </span>
      </div>
    );
  }

  // idle
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl bg-gray-50/90 px-8 py-5 shadow-md backdrop-blur-sm">
      <span className="inline-flex h-8 w-8 rounded-full bg-gray-300" />
      <span className="text-base font-semibold text-muted-foreground">
        {agentStateLabel("idle")}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Coach Content                                                */
/* ------------------------------------------------------------------ */
function CoachContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const attemptId = searchParams.get("attempt_id") || "";
  const isRetry = searchParams.get("retry") === "true";
  const fromReview = searchParams.get("from") === "review";
  const verifyEnabled = searchParams.get("verify") !== "false";

  const wasCorrectEntry = useAppStore((s) => s.wasCorrectEntry);
  const setCoachingComplete = useAppStore((s) => s.setCoachingComplete);
  const setCoachingTurnCount = useAppStore((s) => s.setCoachingTurnCount);
  const setVariantProblem = useAppStore((s) => s.setVariantProblem);
  const setVerifyWorkPhoto = useAppStore((s) => s.setVerifyWorkPhoto);
  const setCurrentProblem = useAppStore((s) => s.setCurrentProblem);
  const resetToSolve = useAppStore((s) => s.resetToSolve);
  const workbookId = useAppStore((s) => s.workbookId);
  const currentPage = useAppStore((s) => s.currentPage);
  const currentNumber = useAppStore((s) => s.currentNumber);
  const lastVerifyContext = useAppStore((s) => s.lastVerifyContext);
  const setReviewFromCoaching = useAppStore((s) => s.setReviewFromCoaching);
  const gradeResult = useAppStore((s) => s.gradeResult);
  const currentDiagramSvg = useAppStore((s) => s.currentDiagramSvg);

  const t = useTranslations("coach");
  const tCommon = useTranslations("common");

  const [problemInfoOpen, setProblemInfoOpen] = useState(false);
  const [textInput, setTextInput] = useState("");

  // RMS value stored in a ref to avoid re-renders
  const rmsRef = useRef(0);

  const handleRmsUpdate = useCallback((rms: number) => {
    rmsRef.current = rms;
  }, []);

  const {
    connected,
    recording,
    transcript,
    turnCount,
    coachingComplete,
    silentTooLong,
    agentState,
    error: audioError,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    sendText,
  } = useAudioSession({
    attemptId,
    retry: isRetry,
    variantContext: isRetry && lastVerifyContext
      ? {
          display_text: lastVerifyContext.variant_display_text,
          correct_answer: lastVerifyContext.variant_correct_answer,
          student_answer: lastVerifyContext.variant_student_answer,
        }
      : null,
    onCoachingComplete: (tc) => {
      setCoachingComplete(true);
      setCoachingTurnCount(tc);
    },
    onTurnComplete: (tc) => {
      setCoachingTurnCount(tc);
    },
    onRmsUpdate: handleRmsUpdate,
  });

  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-start coaching session on mount
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStarted.current && connect) {
      autoStarted.current = true;
      connect();
      setTimeout(() => startRecording(), 1000);
    }
  }, [connect, startRecording]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Always allow exit — user can skip coaching at any time
  const canExit = true;

  const handleExit = async () => {
    disconnect();

    if (fromReview) {
      setReviewFromCoaching(true);
      router.push("/student/review");
    } else if (wasCorrectEntry) {
      try {
        const next = await getNextProblem(workbookId || "demo", currentPage, currentNumber);
        if (next.page != null && next.number != null) setCurrentProblem(next.page, next.number);
      } catch { /* stay */ }
      resetToSolve();
      router.push("/student/solve");
    } else if (!verifyEnabled) {
      try { await markMastered(workbookId || "", currentPage, currentNumber); } catch { /* */ }
      try {
        const next = await getNextProblem(workbookId || "", currentPage, currentNumber);
        if (next.page != null && next.number != null) setCurrentProblem(next.page, next.number);
      } catch { /* */ }
      resetToSolve();
      router.push("/student/solve");
    } else {
      try { await markCoached(workbookId || "", currentPage, currentNumber); } catch { /* */ }
      setVariantProblem(null);
      setVerifyWorkPhoto(null);
      router.push("/student/verify");
    }
  };

  const handleSendText = () => {
    const text = textInput.trim();
    if (!text) return;
    sendText(text);
    setTextInput("");
  };

  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col">
      {/* Header — only when not connected */}
      {!connected && (
        <div className="border-b bg-muted/50 p-3">
          <p className="text-center text-sm">
            {fromReview ? (
              <span className="text-orange-600">{t("reviewCoaching")}</span>
            ) : wasCorrectEntry ? (
              <span className="text-green-600">{t("correctReview")}</span>
            ) : isRetry ? (
              <span className="text-orange-600">{t("retryCoaching")}</span>
            ) : (
              <span className="text-red-600">{t("wrongCoaching")}</span>
            )}
          </p>
        </div>
      )}

      {/* Status bar when connected */}
      {connected && (
        <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <AgentStateIndicator state={agentState} />
            <span className="text-muted-foreground">{t("turn")}{turnCount}</span>
          </div>
          <div className="flex items-center gap-2">
            {!wasCorrectEntry && !coachingComplete && (
              <span>{t("minTurns")}{COACHING.MIN_TURNS_FOR_WRONG}{t("minTurnsSuffix")}</span>
            )}
            {coachingComplete && (
              <Badge variant="default" className="text-xs">{t("coachingComplete")}</Badge>
            )}
          </div>
        </div>
      )}

      {/* Audio error banner */}
      {audioError && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive">
          {audioError}
        </div>
      )}

      {/* Collapsible problem info panel */}
      <ProblemInfoPanel
        open={problemInfoOpen}
        onToggle={() => setProblemInfoOpen((v) => !v)}
        isRetry={isRetry}
        fromReview={fromReview}
        lastVerifyContext={lastVerifyContext}
        gradeResult={gradeResult}
        currentPage={currentPage}
        currentNumber={currentNumber}
        diagramSvg={currentDiagramSvg}
      />

      {/* Transcript area */}
      <div className="relative flex-1 overflow-y-auto p-4">
        {transcript.length === 0 && !audioError && !connected && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <p>{t("pressStart")}</p>
            <p className="text-xs">{t("micPermission")}</p>
          </div>
        )}

        {/* Large centered agent state indicator (not shown while speaking) */}
        {connected && agentState !== "speaking" && (
          <div className="pointer-events-none sticky top-0 z-10 flex justify-center py-4">
            <LargeStateIndicator state={agentState} />
          </div>
        )}

        <div className="space-y-3">
          {transcript.map((entry, i) => (
            <div
              key={i}
              className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <Card
                className={`max-w-[80%] rounded-2xl border-0 px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                  entry.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                <MathText>{entry.text}</MathText>
              </Card>
            </div>
          ))}
          {/* AI silence warning */}
          {silentTooLong && connected && !coachingComplete && (
            <div className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-center text-xs text-orange-600">
              {t("aiNotResponding")}
            </div>
          )}
          <div ref={transcriptEndRef} />
        </div>
      </div>

      {/* Text input area */}
      {connected && (
        <div className="flex gap-2 border-t px-4 py-2">
          <Input
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && textInput.trim()) {
                handleSendText();
              }
            }}
            placeholder={t("textPlaceholder")}
            className="flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!textInput.trim()}
            onClick={handleSendText}
          >
            {tCommon("send")}
          </Button>
        </div>
      )}

      {/* Controls */}
      <div className="border-t bg-background p-4">
        {!connected ? (
          <div className="flex justify-center">
            <Button
              size="lg"
              onClick={() => {
                connect();
                setTimeout(() => startRecording(), 1000);
              }}
              className="rounded-full px-10 py-6 text-lg font-semibold shadow-lg"
            >
              {t("startCoaching")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* RMS bars — only when listening */}
            {recording && agentState === "listening" && (
              <div className="flex justify-center">
                <RmsLevelBars rmsRef={rmsRef} />
              </div>
            )}

            {/* Action buttons row */}
            <div className="flex items-center justify-between">
              {/* Exit button */}
              <Button
                variant="default"
                onClick={handleExit}
                className="rounded-full px-5 py-3"
              >
                {fromReview
                  ? t("continueReview")
                  : wasCorrectEntry
                    ? t("nextProblem")
                    : verifyEnabled
                      ? t("solveVerify")
                      : t("nextProblem")}
              </Button>

              {/* Mic toggle button */}
              <button
                onClick={recording ? stopRecording : startRecording}
                className={`flex h-16 w-16 items-center justify-center rounded-full text-2xl transition-all ${
                  recording
                    ? "animate-pulse bg-destructive text-white shadow-lg"
                    : "bg-primary text-primary-foreground shadow-lg"
                }`}
              >
                {recording ? "⏸" : "🎤"}
              </button>

              {/* Status text */}
              <div className="w-20 text-center">
                {recording && (
                  <span className="text-xs font-medium text-destructive">
                    {t("recording")}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Problem Info Panel                                                */
/* ------------------------------------------------------------------ */
function ProblemInfoPanel({
  open,
  onToggle,
  isRetry,
  fromReview,
  lastVerifyContext,
  gradeResult,
  currentPage,
  currentNumber,
  diagramSvg,
}: {
  open: boolean;
  onToggle: () => void;
  isRetry: boolean;
  fromReview: boolean;
  lastVerifyContext: { variant_display_text: string; variant_correct_answer: string; variant_student_answer: string } | null;
  gradeResult: { problem_description?: string | null; student_answer: string | null; error_tag: string | null; feedback: string } | null;
  currentPage: number;
  currentNumber: number;
  diagramSvg?: string | null;
}) {
  const t = useTranslations("coach");
  const tCommon = useTranslations("common");
  const errorTagLabel = useErrorTagLabel();

  let problemText = "";
  let studentAnswer = "";
  let errorTag = "";
  let pageInfo = "";
  let svgToShow = diagramSvg || null;

  if ((isRetry || fromReview) && lastVerifyContext) {
    problemText = lastVerifyContext.variant_display_text;
    studentAnswer = lastVerifyContext.variant_student_answer;
    // Variant problems may have their own SVG (from variant generation)
    svgToShow = null;
  } else if (gradeResult) {
    problemText = gradeResult.problem_description || "";
    studentAnswer = gradeResult.student_answer || "";
    errorTag = gradeResult.error_tag || "";
    pageInfo = tCommon("pageNumber", { page: currentPage, number: currentNumber });
  }

  if (!problemText) problemText = t("noProblemInfo");

  return (
    <div className="border-b">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
      >
        <span className="font-medium">{t("problemInfo")}</span>
        <span className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="space-y-1.5 px-4 pb-3 text-sm">
          {pageInfo && <p className="text-xs text-muted-foreground">{pageInfo}</p>}
          {problemText && (
            <MathText as="p" className="font-medium leading-relaxed" diagramSvg={svgToShow}>{problemText}</MathText>
          )}
          {studentAnswer && (
            <p className="text-xs text-muted-foreground">
              {tCommon("myAnswer")}<span className="font-mono font-semibold text-foreground">{studentAnswer}</span>
            </p>
          )}
          {errorTag && errorTag !== "none" && (
            <Badge variant="destructive" className="text-xs">
              {errorTagLabel(errorTag)}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Wrapper                                                      */
/* ------------------------------------------------------------------ */
function CoachFallback() {
  const t = useTranslations("coach");
  return (
    <div className="flex items-center justify-center py-20 text-muted-foreground">
      {t("loadingInfo")}
    </div>
  );
}

export default function CoachPage() {
  return (
    <Suspense fallback={<CoachFallback />}>
      <CoachContent />
    </Suspense>
  );
}
