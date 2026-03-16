"use client";

import { useState, useRef, useCallback } from "react";
import {
  testDiagram,
  type TestDiagramProblem,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MathText } from "@/components/MathText";
import { ImageCropper } from "@/components/ImageCropper";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";

type DiagramMode = "svg" | "original";

export default function TestDiagramPage() {
  const t = useTranslations("testDiagram");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [problems, setProblems] = useState<TestDiagramProblem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  // Track per-problem display mode: SVG or original image
  const [diagramModes, setDiagramModes] = useState<Record<number, DiagramMode>>({});
  // Cropped image data URLs per problem
  const [croppedImages, setCroppedImages] = useState<Record<number, string>>({});
  // Which problem is currently being cropped (null = cropper closed)
  const [croppingProblem, setCroppingProblem] = useState<number | null>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setSelectedFile(file);
      setImagePreview(URL.createObjectURL(file));
      setProblems([]);
      setError(null);
      setElapsedMs(null);
      setDiagramModes({});
      setCroppedImages({});
    },
    [],
  );

  const handleAnalyze = useCallback(async () => {
    if (!selectedFile) return;
    setLoading(true);
    setError(null);
    setProblems([]);
    setDiagramModes({});
    setCroppedImages({});
    const start = Date.now();
    try {
      const result = await testDiagram(selectedFile);
      setElapsedMs(Date.now() - start);
      setProblems(result.problems);
    } catch (err) {
      setElapsedMs(Date.now() - start);
      setError(err instanceof Error ? err.message : t("analysisFailed"));
    } finally {
      setLoading(false);
    }
  }, [selectedFile, t]);

  const handleRegenerate = useCallback(
    async (idx: number) => {
      if (!selectedFile) return;
      setLoading(true);
      try {
        const result = await testDiagram(selectedFile);
        const updated = result.problems.find(
          (p) => p.number === problems[idx].number,
        );
        if (updated) {
          setProblems((prev) => {
            const next = [...prev];
            next[idx] = updated;
            return next;
          });
          setDiagramModes((prev) => ({ ...prev, [problems[idx].number]: "svg" }));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("regenFailed"));
      } finally {
        setLoading(false);
      }
    },
    [selectedFile, problems, t],
  );

  // Open cropper for a specific problem
  const openCropper = useCallback((probNumber: number) => {
    setCroppingProblem(probNumber);
  }, []);

  // Handle crop completion
  const handleCropDone = useCallback(
    (croppedFile: File) => {
      if (croppingProblem === null) return;
      const url = URL.createObjectURL(croppedFile);
      setCroppedImages((prev) => ({ ...prev, [croppingProblem]: url }));
      setDiagramModes((prev) => ({ ...prev, [croppingProblem]: "original" }));
      setCroppingProblem(null);
    },
    [croppingProblem],
  );

  const handleReset = useCallback(() => {
    setSelectedFile(null);
    setImagePreview(null);
    setProblems([]);
    setError(null);
    setElapsedMs(null);
    setDiagramModes({});
    setCroppedImages({});
    setCroppingProblem(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // Find the problem currently being cropped (for initialCrop)
  const croppingProb = croppingProblem !== null
    ? problems.find((p) => p.number === croppingProblem)
    : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <h1 className="text-xl font-bold">{t("title")}</h1>
      <p className="text-sm text-slate-500 whitespace-pre-line">
        {t("description")}
      </p>

      {/* Upload area */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
          />

          {imagePreview && (
            <div className="overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreview}
                alt={t("uploadedImageAlt")}
                className="max-h-[400px] w-full object-contain"
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleAnalyze}
              disabled={!selectedFile || loading}
            >
              {loading ? t("analyzing") : t("startAnalysis")}
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={loading}>
              {t("reset")}
            </Button>
          </div>

          {elapsedMs !== null && (
            <p className="text-xs text-slate-400">
              {t("elapsed", { seconds: (elapsedMs / 1000).toFixed(1) })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      )}

      {/* Results */}
      {problems.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {t("resultsTitle", { count: problems.length })}
          </h2>

          {problems.map((prob, idx) => {
            const mode = diagramModes[prob.number] ?? "svg";
            const hasDiagram = !!prob.diagram_description;
            const croppedSrc = croppedImages[prob.number];
            const isInteraction = prob.is_image_interaction;

            return (
              <Card key={prob.number}>
                <CardContent className="space-y-3 p-4">
                  {/* Header */}
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{t("numberSuffix", { number: prob.number })}</Badge>
                    {isInteraction ? (
                      <Badge variant="outline" className="text-orange-600">
                        {t("imageInteractionConverted")}
                      </Badge>
                    ) : hasDiagram ? (
                      <Badge variant="outline" className="text-blue-600">
                        {t("hasDiagram")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-slate-400">
                        {t("textOnly")}
                      </Badge>
                    )}
                    {hasDiagram && !isInteraction && mode === "original" && (
                      <Badge variant="outline" className="text-amber-600">
                        {t("sourceImageCropped")}
                      </Badge>
                    )}
                  </div>

                  {/* Extracted text */}
                  <div>
                    <p className="mb-1 text-xs font-medium text-slate-500">
                      {t("extractedText")}
                    </p>
                    <div className="rounded bg-slate-50 p-3 text-sm">
                      <MathText>{prob.description}</MathText>
                    </div>
                  </div>

                  {/* Image-interaction: show converted text */}
                  {isInteraction && (
                    <div>
                      <p className="mb-1 text-xs font-medium text-slate-500">
                        {t("convertedToChoice")}
                      </p>
                      {prob.converted_text ? (
                        <div className="rounded border-2 border-green-200 bg-green-50 p-3 text-sm">
                          <MathText>{prob.converted_text}</MathText>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-700">
                          {t("convertFailed")}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Diagram description (non-interaction only) */}
                  {hasDiagram && !isInteraction && (
                    <div>
                      <p className="mb-1 text-xs font-medium text-slate-500">
                        {t("diagramDescription")}
                      </p>
                      <p className="text-sm text-slate-700">
                        {prob.diagram_description}
                      </p>
                    </div>
                  )}

                  {/* Diagram display: SVG or Cropped original (non-interaction only) */}
                  {hasDiagram && !isInteraction && (
                    <div>
                      <p className="mb-1 text-xs font-medium text-slate-500">
                        {mode === "svg" ? t("generatedSvg") : t("sourceImageCropLabel")}
                      </p>
                      <div className="rounded-lg border bg-white p-4">
                        {mode === "svg" && prob.diagram_svg && (
                          <MathText diagramSvg={prob.diagram_svg}>
                            {t("diagramFallback", { description: prob.diagram_description ?? "" })}
                          </MathText>
                        )}
                        {mode === "svg" && !prob.diagram_svg && (
                          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-700">
                            {t("svgGenFailed")}
                          </div>
                        )}
                        {mode === "original" && croppedSrc && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={croppedSrc}
                            alt={t("cropImageAlt", { number: prob.number })}
                            className="mx-auto max-h-[400px] object-contain"
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Action buttons (non-interaction only) */}
                  {hasDiagram && !isInteraction && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRegenerate(idx)}
                        disabled={loading}
                      >
                        {t("regenSvg")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openCropper(prob.number)}
                      >
                        {croppedSrc ? t("adjustArea") : t("replaceWithSource")}
                      </Button>
                      {mode === "original" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDiagramModes((prev) => ({
                              ...prev,
                              [prob.number]: "svg",
                            }))
                          }
                        >
                          {t("switchToSvg")}
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* No problems found */}
      {!loading && problems.length === 0 && elapsedMs !== null && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          {t("noProblemsFound")}
        </div>
      )}

      {/* Cropper overlay */}
      {croppingProblem !== null && imagePreview && (
        <ImageCropper
          imageSrc={imagePreview}
          initialCrop={croppingProb?.diagram_bounds ?? undefined}
          onCropDone={handleCropDone}
          onCancel={() => setCroppingProblem(null)}
        />
      )}
    </div>
  );
}
