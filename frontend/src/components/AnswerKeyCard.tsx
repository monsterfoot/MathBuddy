"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MathText } from "@/components/MathText";
import { SCAN, DIAGRAM } from "@/lib/constants";
import type { AnswerKeyEntry } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SectionType = "answer" | "problem" | "explanation";

export interface EditState {
  answer: string;
  problemDesc: string;
  steps: string;
  pitfalls: string;
  pageStart: string;
  pageEnd: string;
}

export interface LoadingState {
  saving: boolean;
  ocr: boolean;
  ocrSection?: "problem" | "explanation" | null;
  diagram?: boolean;
  convertText?: boolean;
  replaceImage?: boolean;
}

export interface CardCallbacks {
  onToggleSection: (section: SectionType) => void;
  onSetExpanded: (section: SectionType, editing: boolean) => void;
  onDelete: () => void;
  onEditChange: (field: keyof EditState, value: string) => void;
  onSaveAnswer: () => void;
  onStartEditAnswer: () => void;
  onSaveProblem: () => void;
  onStartEditProblem: () => void;
  onClearProblem: () => void;
  onSaveExplanation: () => void;
  onStartEditExplanation: () => void;
  onClearExplanation: () => void;
  onToggleFlag: (flag: "review_enabled" | "verify_enabled") => void;
  onOcr: (section: "problem" | "explanation") => void;
  onRegenDiagram?: () => void;
  onRevertToDiagram?: () => void;
  onConvertToText?: () => void;
  onOpenImageCropper?: () => void;
}

export interface AnswerKeyCardProps {
  entry: AnswerKeyEntry;
  id: string;
  expandedSection: {
    id: string;
    section: SectionType;
    editing: boolean;
  } | null;
  stats?: {
    correct: number;
    wrong: number;
    coached: number;
    mastered: number;
  } | null;
  isOwner: boolean;
  showSaved: boolean;
  editState: EditState;
  loadingState: LoadingState;
  callbacks: CardCallbacks;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnswerKeyCard({
  entry: key,
  id,
  expandedSection: expSec,
  stats,
  isOwner,
  showSaved,
  editState,
  loadingState,
  callbacks,
}: AnswerKeyCardProps) {
  const t = useTranslations("workbookDetail");
  const tCommon = useTranslations("common");

  const hasDiagramMarker = key.problem_description?.match(
    new RegExp(DIAGRAM.PATTERN.source),
  );

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-white shadow-sm ${
        key.extraction_confidence < SCAN.CONFIDENCE_WARN_THRESHOLD
          ? "border-yellow-400"
          : "border-gray-200"
      }`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-5 py-3">
        <div className="flex items-center gap-2.5">
          {/* Number badge -- owner can click to delete */}
          {isOwner ? (
            <button
              onClick={callbacks.onDelete}
              title={tCommon("delete")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-gray-100 text-[11px] font-bold text-gray-400 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
            >
              {key.number}
            </button>
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-gray-100 text-[11px] font-bold text-gray-400">
              {key.number}
            </span>
          )}

          {/* Optional stats badges */}
          {stats && (
            <div className="flex gap-1">
              <div className="flex h-6 w-6 items-center justify-center rounded-md border border-emerald-200 bg-emerald-100 text-[11px] font-bold text-emerald-700">
                {stats.correct}
              </div>
              <div className="flex h-6 w-6 items-center justify-center rounded-md border border-rose-200 bg-rose-100 text-[11px] font-bold text-rose-700">
                {stats.wrong}
              </div>
              <div className="flex h-6 w-6 items-center justify-center rounded-md border border-amber-200 bg-amber-100 text-[11px] font-bold text-amber-700">
                {stats.coached}
              </div>
              <div className="flex h-6 w-6 items-center justify-center rounded-md border border-blue-200 bg-blue-100 text-[11px] font-bold text-blue-700">
                {stats.mastered}
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {/* Answer button */}
          <button
            onClick={() => callbacks.onToggleSection("answer")}
            className={`flex h-6 items-center rounded-md px-2 text-xs font-bold transition-colors bg-green-50 text-green-600 hover:bg-green-100 ${
              expSec?.section === "answer" ? "ring-1 ring-green-400" : ""
            }`}
          >
            {t("answerLabel")}
          </button>

          {/* Problem button */}
          <button
            onClick={() => callbacks.onToggleSection("problem")}
            className={`flex h-6 items-center rounded-md px-2 text-xs font-bold transition-colors ${
              key.problem_description
                ? "bg-purple-50 text-purple-600 hover:bg-purple-100"
                : "border border-gray-100 bg-gray-50 text-gray-500 hover:bg-gray-100"
            } ${expSec?.section === "problem" ? "ring-1 ring-purple-400" : ""}`}
          >
            {key.problem_description ? t("problemLabel") : t("addProblem")}
          </button>

          {/* Explanation button */}
          <button
            onClick={() => callbacks.onToggleSection("explanation")}
            className={`flex h-6 items-center rounded-md px-2 text-xs font-bold transition-colors ${
              key.solution_steps.length > 0
                ? "bg-blue-50 text-blue-600 hover:bg-blue-100"
                : "border border-gray-100 bg-gray-50 text-gray-500 hover:bg-gray-100"
            } ${expSec?.section === "explanation" ? "ring-1 ring-blue-400" : ""}`}
          >
            {key.solution_steps.length > 0
              ? t("explanationLabel")
              : t("addExplanation")}
          </button>

          {/* Divider */}
          <div className="mx-1 h-3 w-[1px] bg-gray-200" />

          {/* R toggle */}
          <button
            onClick={() => isOwner && callbacks.onToggleFlag("review_enabled")}
            title={
              key.review_enabled !== false
                ? t("reviewIncluded")
                : t("reviewExcluded")
            }
            disabled={!isOwner}
            className={`flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-black transition-all ${
              !isOwner
                ? key.review_enabled !== false
                  ? "bg-sky-100 text-sky-500 cursor-default"
                  : "bg-gray-200 text-gray-500 line-through cursor-default"
                : key.review_enabled !== false
                  ? "bg-sky-100 text-sky-500 hover:bg-sky-200"
                  : "bg-gray-200 text-gray-500 line-through"
            }`}
          >
            R
          </button>

          {/* C toggle */}
          <button
            onClick={() =>
              isOwner &&
              !key.image_dependent &&
              callbacks.onToggleFlag("verify_enabled")
            }
            title={
              key.image_dependent
                ? t("imageDependent")
                : key.verify_enabled !== false
                  ? t("verifyIncluded")
                  : t("verifyExcluded")
            }
            disabled={!isOwner || key.image_dependent}
            className={`flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-black transition-all ${
              !isOwner
                ? key.verify_enabled !== false
                  ? "bg-sky-100 text-sky-500 cursor-default"
                  : "bg-gray-200 text-gray-500 line-through cursor-default"
                : key.image_dependent
                  ? "cursor-not-allowed bg-gray-100 text-gray-300"
                  : key.verify_enabled !== false
                    ? "bg-sky-100 text-sky-500 hover:bg-sky-200"
                    : "bg-gray-200 text-gray-500 line-through"
            }`}
          >
            C
          </button>
        </div>
      </div>

      {/* Expanded section: Answer */}
      {expSec?.section === "answer" && (
        <div className="space-y-2 border-t px-5 pb-4 pt-3">
          {expSec.editing ? (
            <div className="space-y-2">
              <textarea
                value={editState.answer}
                onChange={(e) =>
                  callbacks.onEditChange("answer", e.target.value)
                }
                rows={3}
                className="w-full rounded-md border px-2 py-1.5 text-xs"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={loadingState.saving}
                  onClick={callbacks.onSaveAnswer}
                  className="h-7 bg-indigo-600 px-3 text-xs text-white hover:bg-indigo-700"
                >
                  {loadingState.saving ? tCommon("saving") : tCommon("save")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => callbacks.onSetExpanded("answer", false)}
                >
                  {tCommon("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-gray-900">
                <MathText as="p" className={key.final_answer.includes("$") ? "" : "font-mono"}>
                  {key.final_answer}
                </MathText>
                {key.extraction_confidence < SCAN.CONFIDENCE_WARN_THRESHOLD && (
                  <span className="ml-1.5 text-xs text-red-500">!</span>
                )}
              </div>
              {showSaved && (
                <span className="text-xs text-green-600 animate-pulse">
                  {t("saved")}
                </span>
              )}
              {isOwner && (
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={callbacks.onStartEditAnswer}
                  >
                    {t("edit")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Expanded section: Problem */}
      {expSec?.section === "problem" && (
        <div className="space-y-2 border-t px-5 pb-4 pt-3">
          {expSec.editing ? (
            <div className="space-y-2">
              <textarea
                value={editState.problemDesc}
                onChange={(e) =>
                  callbacks.onEditChange("problemDesc", e.target.value)
                }
                rows={3}
                className="w-full rounded-md border px-2 py-1.5 text-xs"
                placeholder={t("problemDescPlaceholder")}
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={loadingState.saving}
                  onClick={callbacks.onSaveProblem}
                  className="h-7 bg-indigo-600 px-3 text-xs text-white hover:bg-indigo-700"
                >
                  {loadingState.saving ? tCommon("saving") : tCommon("save")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => callbacks.onSetExpanded("problem", false)}
                >
                  {tCommon("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {/* image_dependent badge */}
              {key.image_dependent && (
                <div className="rounded-md bg-orange-50 px-2 py-1 text-[10px] text-orange-700">
                  {t("imageDependentNote")}
                </div>
              )}
              {key.problem_description ? (
                <MathText
                  as="p"
                  className="text-xs text-gray-700 leading-relaxed"
                  diagramSvg={key.diagram_svg}
                  problemImageUrl={key.problem_image_url}
                >
                  {key.problem_description}
                </MathText>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("noProblemData")}
                </p>
              )}
              {isOwner && (
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={callbacks.onStartEditProblem}
                  >
                    {t("edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={loadingState.ocr}
                    onClick={() => callbacks.onOcr("problem")}
                  >
                    {loadingState.ocr && loadingState.ocrSection === "problem"
                      ? tCommon("converting")
                      : t("photoToText")}
                  </Button>
                  {key.problem_description && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-red-500 hover:text-red-700"
                      onClick={callbacks.onClearProblem}
                    >
                      {tCommon("delete")}
                    </Button>
                  )}
                  {/* Diagram-related buttons */}
                  {hasDiagramMarker && (
                    <>
                      {key.problem_image_url ? (
                        callbacks.onRevertToDiagram && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={!!loadingState.replaceImage}
                            onClick={callbacks.onRevertToDiagram}
                          >
                            {loadingState.replaceImage
                              ? tCommon("processing")
                              : t("revertToDiagram")}
                          </Button>
                        )
                      ) : (
                        <>
                          {callbacks.onRegenDiagram && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={!!loadingState.diagram}
                              onClick={callbacks.onRegenDiagram}
                            >
                              {loadingState.diagram
                                ? tCommon("generating")
                                : t("regenDiagram")}
                            </Button>
                          )}
                          {callbacks.onConvertToText && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-purple-600 hover:text-purple-800"
                              disabled={!!loadingState.convertText}
                              onClick={callbacks.onConvertToText}
                            >
                              {loadingState.convertText
                                ? tCommon("converting")
                                : t("textConvert")}
                            </Button>
                          )}
                        </>
                      )}
                      {key.source_question_page_url &&
                        callbacks.onOpenImageCropper && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-orange-600 hover:text-orange-800"
                            disabled={!!loadingState.replaceImage}
                            onClick={callbacks.onOpenImageCropper}
                          >
                            {loadingState.replaceImage
                              ? tCommon("processing")
                              : key.problem_image_url
                                ? t("adjustArea")
                                : t("replaceWithSource")}
                          </Button>
                        )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Expanded section: Explanation */}
      {expSec?.section === "explanation" && (
        <div className="space-y-2 border-t px-5 pb-4 pt-3">
          {expSec.editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("solutionStepsLabel")}
                </label>
                <textarea
                  value={editState.steps}
                  onChange={(e) =>
                    callbacks.onEditChange("steps", e.target.value)
                  }
                  rows={5}
                  className="mt-1 w-full rounded-md border px-2 py-1.5 text-xs"
                  placeholder="1단계: ...&#10;2단계: ..."
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("commonMistakesLabel")}
                </label>
                <textarea
                  value={editState.pitfalls}
                  onChange={(e) =>
                    callbacks.onEditChange("pitfalls", e.target.value)
                  }
                  rows={3}
                  className="mt-1 w-full rounded-md border px-2 py-1.5 text-xs"
                  placeholder={t("pitfallPlaceholder")}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("pageRange")}
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    type="number"
                    value={editState.pageStart}
                    onChange={(e) =>
                      callbacks.onEditChange("pageStart", e.target.value)
                    }
                    placeholder={t("startPage")}
                    className="h-7 w-20 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">~</span>
                  <Input
                    type="number"
                    value={editState.pageEnd}
                    onChange={(e) =>
                      callbacks.onEditChange("pageEnd", e.target.value)
                    }
                    placeholder={t("endPage")}
                    className="h-7 w-20 text-xs"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={loadingState.saving}
                  onClick={callbacks.onSaveExplanation}
                  className="h-7 bg-indigo-600 px-3 text-xs text-white hover:bg-indigo-700"
                >
                  {loadingState.saving ? tCommon("saving") : tCommon("save")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => callbacks.onSetExpanded("explanation", false)}
                >
                  {tCommon("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {key.solution_steps.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("solutionProcess")}
                  </p>
                  <ol className="mt-1 list-inside list-decimal space-y-0.5">
                    {key.solution_steps.map((s, i) => (
                      <li key={i} className="text-xs text-gray-700">
                        <MathText>{s}</MathText>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("noExplanation")}
                </p>
              )}
              {key.pitfalls.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("commonMistakes")}
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {key.pitfalls.map((p, i) => (
                      <li key={i} className="text-xs text-orange-600">
                        <MathText>{p}</MathText>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {isOwner && (
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={callbacks.onStartEditExplanation}
                  >
                    {t("edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={loadingState.ocr}
                    onClick={() => callbacks.onOcr("explanation")}
                  >
                    {loadingState.ocr &&
                    loadingState.ocrSection === "explanation"
                      ? tCommon("converting")
                      : t("photoToText")}
                  </Button>
                  {key.solution_steps.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-red-500 hover:text-red-700"
                      onClick={callbacks.onClearExplanation}
                    >
                      {tCommon("delete")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
