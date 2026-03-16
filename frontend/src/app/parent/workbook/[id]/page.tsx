"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getWorkbook,
  getWorkbookAnswerKeys,
  editWorkbookAnswerKey,
  forkWorkbook,
  updateWorkbook,
  deleteWorkbook,
  uploadProblemImageForDescription,
  ocrWorkbookExplanation,
  deleteWorkbookAnswerKey,
  deleteProblemDescription,
  regenerateDiagram,
  addWorkbookAnswerKey,
  convertMathText,
  latexToPlain,
  uploadProblemImageForAdd,
  fetchWorkbookSourceImage,
  getWorkbookStats,
  getWorkbookAssignments,
  assignStudent,
  unassignStudent,
  getMyStudents,
  type Workbook,
  type AnswerKeyEntry,
  type ProblemStats,
  type AssignedStudent,
  type UserProfileResponse,
  listDisputes,
  type Dispute,
} from "@/lib/api";
import { DIAGRAM, SCAN } from "@/lib/constants";
import { useAuth } from "@/components/AuthProvider";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MathText } from "@/components/MathText";
import { ImageCropper } from "@/components/ImageCropper";
import { AnswerKeyCard } from "@/components/AnswerKeyCard";
import { latexToPlainLocal } from "@/lib/latex-to-plain";

export default function WorkbookDetailPage() {
  const params = useParams();
  const router = useRouter();
  const workbookId = params.id as string;
  const t = useTranslations("workbookDetail");
  const tCommon = useTranslations("common");
  const tVis = useTranslations("visibility");
  const tRoot = useTranslations();

  const { firebaseUser } = useAuth();
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [answerKeys, setAnswerKeys] = useState<AnswerKeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  // Problem stats (aggregated from Firestore across all students)
  const [problemStats, setProblemStats] = useState<ProblemStats>({});
  const [totalAssigned, setTotalAssigned] = useState(0);

  // Student assignment state
  const [assignedStudents, setAssignedStudents] = useState<AssignedStudent[]>([]);
  const [allStudents, setAllStudents] = useState<UserProfileResponse[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const [showAssignSection, setShowAssignSection] = useState(false);

  // Label editing state
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState("");
  const [savedLabel, setSavedLabel] = useState(false);

  // Answer editing state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editAnswer, setEditAnswer] = useState("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  // OCR state
  const [ocrLoading, setOcrLoading] = useState(false);
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const [ocrTarget, setOcrTarget] = useState<{
    key: AnswerKeyEntry;
    section: "problem" | "explanation";
  } | null>(null);

  // Diagram regeneration state
  const [diagramLoading, setDiagramLoading] = useState<string | null>(null);

  // Text conversion state (image_dependent → text-only)
  const [convertingToText, setConvertingToText] = useState<string | null>(null);
  // Replace with original image state
  const [replacingImageId, setReplacingImageId] = useState<string | null>(null);
  const [croppingKey, setCroppingKey] = useState<AnswerKeyEntry | null>(null);
  const [cropperImageUrl, setCropperImageUrl] = useState<string | null>(null);

  // Disputes (오채점)
  const [disputes, setDisputes] = useState<Dispute[]>([]);

  // Add problem form state
  const [addingInPage, setAddingInPage] = useState<number | null>(null);
  const [addForm, setAddForm] = useState({
    number: "",
    answer: "",
    problem: "",
    steps: "",
    pitfalls: "",
    reviewEnabled: true,
    verifyEnabled: true,
    imageDependent: false,
    problemImageUrl: null as string | null,
  });
  const [addSaving, setAddSaving] = useState(false);
  const [converting, setConverting] = useState<string | null>(null); // which field
  const addImageRef = useRef<HTMLInputElement>(null);
  const [addImageUploading, setAddImageUploading] = useState(false);

  useEffect(() => {
    if (!workbookId) return;
    getWorkbookStats(workbookId)
      .then((res) => {
        setProblemStats(res.problem_stats);
        setTotalAssigned(res.total_assigned);
      })
      .catch(() => {/* ignore */});
    getWorkbookAssignments(workbookId)
      .then((res) => setAssignedStudents(res.students))
      .catch(() => {/* ignore */});
    listDisputes(workbookId)
      .then((res) => setDisputes(res.disputes))
      .catch(() => {/* ignore */});
    Promise.all([
      getWorkbook(workbookId),
      getWorkbookAnswerKeys(workbookId),
    ])
      .then(([wb, keys]) => {
        setWorkbook(wb);
        setAnswerKeys(keys.answer_keys);
      })
      .catch(() => setError(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [workbookId]);

  const keyId = (k: AnswerKeyEntry) => `${k.page}_${k.number}`;

  const flashSaved = (kid: string) => {
    setSavedKey(kid);
    setTimeout(() => setSavedKey(null), 2000);
  };

  // ── Save answer ──
  const handleSaveAnswer = async (key: AnswerKeyEntry) => {
    if (!editAnswer.trim()) return;
    setError("");
    setSaving(true);
    try {
      const updated = await editWorkbookAnswerKey(
        workbookId,
        key.page,
        key.number,
        { final_answer: editAnswer.trim() }
      );
      setAnswerKeys((prev) =>
        prev.map((k) =>
          keyId(k) === keyId(key) ? { ...k, ...updated } : k
        )
      );
      setEditingKey(null);
      setEditAnswer("");
      setExpandedSection({ id: keyId(key), section: "answer", editing: false });
      flashSaved(keyId(key));
    } catch {
      setError(t("editFailed"));
    } finally {
      setSaving(false);
    }
  };

  // ── Section toggle ──
  const toggleSection = (key: AnswerKeyEntry, section: "answer" | "problem" | "explanation") => {
    const id = keyId(key);
    if (expandedSection?.id === id && expandedSection.section === section) {
      setExpandedSection(null);
    } else {
      setExpandedSection({ id, section, editing: false });
    }
  };

  // ── Start editing a section ──
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

  // ── Save problem description ──
  const handleSaveProblem = async (key: AnswerKeyEntry) => {
    const id = keyId(key);
    setError("");
    setSaving(true);
    try {
      const updated = await editWorkbookAnswerKey(
        workbookId,
        key.page,
        key.number,
        { problem_description: editProblemDesc.trim() || null }
      );
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

  // ── Save explanation ──
  const handleSaveExplanation = async (key: AnswerKeyEntry) => {
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

      const updated = await editWorkbookAnswerKey(
        workbookId,
        key.page,
        key.number,
        data
      );
      setAnswerKeys((prev) =>
        prev.map((k) =>
          keyId(k) === id ? { ...k, ...updated } : k
        )
      );
      setExpandedSection({ id, section: "explanation", editing: false });
      flashSaved(id);
    } catch {
      setError(t("explanationEditFailed"));
    } finally {
      setSaving(false);
    }
  };

  // ── Delete answer key ──
  const handleDeleteAnswerKey = async (key: AnswerKeyEntry) => {
    if (!confirm(t("deleteConfirm", { page: key.page, number: key.number }))) return;
    setError("");
    try {
      await deleteWorkbookAnswerKey(workbookId, key.page, key.number);
      setAnswerKeys((prev) => prev.filter((k) => keyId(k) !== keyId(key)));
      setExpandedSection(null);
    } catch {
      setError(t("deleteFailed"));
    }
  };

  // ── Clear problem description ──
  const handleClearProblem = async (key: AnswerKeyEntry) => {
    const id = keyId(key);
    setSaving(true);
    try {
      const updated = await deleteProblemDescription(workbookId, key.page, key.number);
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

  // ── Regenerate diagram SVG ──
  const handleRegenerateDiagram = async (key: AnswerKeyEntry) => {
    const id = keyId(key);
    setDiagramLoading(id);
    try {
      const updated = await regenerateDiagram(workbookId, key.page, key.number);
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
      );
      flashSaved(id);
    } catch {
      setError(t("diagramGenFailed"));
    } finally {
      setDiagramLoading(null);
    }
  };

  // ── Clear explanation ──
  const handleClearExplanation = async (key: AnswerKeyEntry) => {
    const id = keyId(key);
    setSaving(true);
    try {
      const updated = await editWorkbookAnswerKey(
        workbookId,
        key.page,
        key.number,
        { solution_steps: [], pitfalls: [] }
      );
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

  // ── OCR: trigger file input ──
  const triggerOcr = (key: AnswerKeyEntry, section: "problem" | "explanation") => {
    setOcrTarget({ key, section });
    ocrFileRef.current?.click();
  };

  // ── OCR: handle file selected ──
  const handleOcrFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !ocrTarget) return;
    if (ocrFileRef.current) ocrFileRef.current.value = "";

    const { key, section } = ocrTarget;
    const id = keyId(key);
    setOcrLoading(true);
    setError("");
    try {
      if (section === "problem") {
        const updated = await uploadProblemImageForDescription(
          workbookId, key.page, key.number, file
        );
        setAnswerKeys((prev) =>
          prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
        );
        setExpandedSection({ id, section: "problem", editing: false });
        flashSaved(id);
      } else {
        const updated = await ocrWorkbookExplanation(
          workbookId, key.page, key.number, file
        );
        setAnswerKeys((prev) =>
          prev.map((k) => (keyId(k) === id ? { ...k, ...updated } : k))
        );
        setExpandedSection({ id, section: "explanation", editing: false });
        flashSaved(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ocrFailed"));
    } finally {
      setOcrLoading(false);
      setOcrTarget(null);
    }
  };

  // ── Add problem: open form for a page group ──
  const handleOpenAddForm = (page: number) => {
    if (addingInPage === page) {
      setAddingInPage(null);
      return;
    }
    // Auto-suggest next number
    const existing = (pageGroups[page] || []).map((k) => k.number);
    const nextNum = existing.length > 0 ? Math.max(...existing) + 1 : 1;
    setAddForm({
      number: String(nextNum),
      answer: "",
      problem: "",
      steps: "",
      pitfalls: "",
      reviewEnabled: true,
      verifyEnabled: true,
      imageDependent: false,
      problemImageUrl: null,
    });
    setAddingInPage(page);
  };

  // ── Add problem: save ──
  const handleAddProblem = async (page: number) => {
    const num = parseInt(addForm.number, 10);
    if (!num || !addForm.answer.trim()) return;
    setAddSaving(true);
    setError("");
    try {
      const created = await addWorkbookAnswerKey(workbookId, {
        page,
        number: num,
        final_answer: addForm.answer.trim(),
        problem_description: addForm.problem.trim() || null,
        solution_steps: addForm.steps.split("\n").map((s) => s.trim()).filter(Boolean),
        pitfalls: addForm.pitfalls.split("\n").map((s) => s.trim()).filter(Boolean),
        image_dependent: addForm.imageDependent,
        problem_image_url: addForm.problemImageUrl,
        review_enabled: addForm.reviewEnabled,
        verify_enabled: addForm.verifyEnabled,
      });
      setAnswerKeys((prev) =>
        [...prev, created].sort((a, b) => a.page - b.page || a.number - b.number)
      );
      setAddingInPage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("addProblemFailed"));
    } finally {
      setAddSaving(false);
    }
  };

  // ── Math convert: send text to Gemini and replace field value ──
  const handleMathConvert = async (field: "problem" | "steps" | "pitfalls") => {
    const text = addForm[field];
    if (!text.trim()) return;
    setConverting(field);
    try {
      const res = await convertMathText(workbookId, text);
      setAddForm((prev) => ({ ...prev, [field]: res.converted }));
    } catch {
      setError(t("mathConvertFailed"));
    } finally {
      setConverting(null);
    }
  };

  // ── Convert to text-only: strip diagram/image, keep text ──
  const handleConvertToText = async (key: AnswerKeyEntry) => {
    const id = keyId(key);
    setConvertingToText(id);
    try {
      const updated = await editWorkbookAnswerKey(workbookId, key.page, key.number, {
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
      setConvertingToText(null);
    }
  };

  // ── Open cropper for replacing diagram with original image ──
  const openImageCropper = async (key: AnswerKeyEntry) => {
    setError("");
    try {
      const blobUrl = await fetchWorkbookSourceImage(workbookId, key.page, key.number);
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

  // ── Handle crop completion: upload + update entry ──
  const handleCropDone = async (croppedFile: File) => {
    if (!croppingKey) return;
    const key = croppingKey;
    const id = keyId(key);
    closeCropper();
    setReplacingImageId(id);
    try {
      const { url } = await uploadProblemImageForAdd(workbookId, croppedFile);
      const updated = await editWorkbookAnswerKey(workbookId, key.page, key.number, {
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

  // ── Revert from original image back to diagram ──
  const handleRevertToDiagram = async (key: AnswerKeyEntry) => {
    const id = keyId(key);
    setReplacingImageId(id);
    try {
      // Clear image first
      const cleared = await editWorkbookAnswerKey(workbookId, key.page, key.number, {
        problem_image_url: null,
        image_dependent: false,
      });
      // Regenerate SVG diagram from [Diagram: ...] marker
      let final_ = cleared;
      try {
        final_ = await regenerateDiagram(workbookId, key.page, key.number);
      } catch {
        // If regen fails (no marker), just show text
      }
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === id ? { ...k, ...final_ } : k))
      );
      flashSaved(id);
    } catch {
      setError(t("revertFailed"));
    } finally {
      setReplacingImageId(null);
    }
  };

  // ── Start editing problem desc with plain text ──
  const startEditProblemPlain = async (key: AnswerKeyEntry) => {
    const id = keyId(key);
    const desc = key.problem_description || "";
    // Convert LaTeX to plain text for easier editing
    let plain = desc;
    try {
      const res = await latexToPlain(workbookId, desc);
      plain = res.plain;
    } catch {
      // Fallback to raw text
    }
    setEditProblemDesc(plain);
    setExpandedSection({ id, section: "problem", editing: true });
  };

  // ── Save problem description (plain → LaTeX) ──
  const handleSaveProblemWithConvert = async (key: AnswerKeyEntry) => {
    const id = keyId(key);
    setError("");
    setSaving(true);
    try {
      let finalDesc = editProblemDesc.trim() || null;
      // Convert plain text to LaTeX before saving
      if (finalDesc) {
        const res = await convertMathText(workbookId, finalDesc);
        finalDesc = res.converted;
      }
      const updated = await editWorkbookAnswerKey(
        workbookId,
        key.page,
        key.number,
        { problem_description: finalDesc }
      );
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

  // ── Add form: upload problem image ──
  const handleAddFormImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (addImageRef.current) addImageRef.current.value = "";
    setAddImageUploading(true);
    try {
      const { url } = await uploadProblemImageForAdd(workbookId, file);
      setAddForm((prev) => ({
        ...prev,
        problemImageUrl: url,
        imageDependent: true,
        verifyEnabled: false,
      }));
    } catch {
      setError(t("imageUploadFailed"));
    } finally {
      setAddImageUploading(false);
    }
  };

  // ── Label editing ──
  const handleSaveLabel = async () => {
    if (!labelValue.trim()) return;
    setError("");
    try {
      const updated = await updateWorkbook(workbookId, { label: labelValue.trim() });
      setWorkbook(updated);
      setEditingLabel(false);
      setSavedLabel(true);
      setTimeout(() => setSavedLabel(false), 2000);
    } catch {
      setError(t("labelSaveFailed"));
    }
  };

  // Group answer keys by page
  const [openPageGroup, setOpenPageGroup] = useState<number | null>(null);
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

  // Auto-open first page group when data loads
  useEffect(() => {
    if (sortedPages.length > 0 && openPageGroup === null) {
      setOpenPageGroup(sortedPages[0]);
    }
  }, [sortedPages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Student assignment ──
  const refreshStats = () => {
    getWorkbookStats(workbookId)
      .then((res) => {
        setProblemStats(res.problem_stats);
        setTotalAssigned(res.total_assigned);
      })
      .catch(() => {/* ignore */});
  };

  const handleOpenAssign = () => {
    setShowAssignSection((prev) => !prev);
    if (allStudents.length === 0) {
      getMyStudents()
        .then((res) => setAllStudents(res.students))
        .catch(() => {/* ignore */});
    }
  };

  const handleAssign = async (studentUid: string) => {
    setAssignLoading(true);
    try {
      await assignStudent(workbookId, studentUid);
      const res = await getWorkbookAssignments(workbookId);
      setAssignedStudents(res.students);
      refreshStats();
    } catch {
      setError(t("assignFailed"));
    } finally {
      setAssignLoading(false);
    }
  };

  const handleUnassign = async (studentUid: string) => {
    if (!confirm(t("unassignConfirm"))) return;
    setAssignLoading(true);
    try {
      await unassignStudent(workbookId, studentUid);
      setAssignedStudents((prev) => prev.filter((s) => s.uid !== studentUid));
      refreshStats();
    } catch {
      setError(t("unassignFailed"));
    } finally {
      setAssignLoading(false);
    }
  };

  // ── Toggle R/C flags ──
  const handleToggleFlag = async (key: AnswerKeyEntry, field: "review_enabled" | "verify_enabled") => {
    const current = key[field] !== false; // default true
    try {
      const updated = await editWorkbookAnswerKey(
        workbookId,
        key.page,
        key.number,
        { [field]: !current },
      );
      setAnswerKeys((prev) =>
        prev.map((k) => (keyId(k) === keyId(key) ? { ...k, ...updated } : k)),
      );
    } catch {
      setError(t("settingsFailed"));
    }
  };

  const handleDelete = async () => {
    if (!confirm(t("deleteWorkbookConfirm"))) return;
    setDeleting(true);
    try {
      await deleteWorkbook(workbookId);
      router.push("/parent");
    } catch {
      setError(t("deleteFailed"));
      setDeleting(false);
    }
  };

  const isOwner = !!(firebaseUser && workbook?.owner_uid && firebaseUser.uid === workbook.owner_uid);

  if (loading) {
    return <p className="py-10 text-center text-muted-foreground">{tCommon("loading")}</p>;
  }

  if (!workbook) {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <p className="py-10 text-center text-sm text-red-500">{error || t("notFound")}</p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/parent">{tCommon("goBack")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-6">
      {/* Hidden OCR file input */}
      <input
        ref={ocrFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleOcrFile}
      />

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          {editingLabel ? (
            <div className="flex items-center gap-2">
              <Input
                value={labelValue}
                onChange={(e) => setLabelValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveLabel()}
                className="h-8 w-40"
                autoFocus
              />
              <Button size="sm" onClick={handleSaveLabel}>
                {tCommon("save")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingLabel(false)}
              >
                {tCommon("cancel")}
              </Button>
            </div>
          ) : (
            <h3
              className={`text-lg font-semibold ${isOwner ? "cursor-pointer hover:text-indigo-600" : ""}`}
              onClick={() => {
                if (!isOwner) return;
                setLabelValue(workbook.label);
                setEditingLabel(true);
              }}
              title={isOwner ? t("labelEditTitle") : undefined}
            >
              {workbook.label}
              {savedLabel && (
                <span className="ml-2 text-sm font-normal text-green-600">
                  {t("saved")}
                </span>
              )}
            </h3>
          )}
          <Badge variant={workbook.status === "locked" ? "default" : "secondary"}>
            {workbook.status === "locked" ? t("registered") : t("draftStatus")}
          </Badge>
          <Badge
            variant="outline"
            className={isOwner && workbook.visibility !== "copied" ? "cursor-pointer" : ""}
            onClick={isOwner && workbook.visibility !== "copied" ? async () => {
              const newVis = workbook.visibility === "public" ? "private" : "public";
              try {
                const updated = await updateWorkbook(workbookId, { visibility: newVis });
                setWorkbook(updated);
              } catch {
                setError(t("settingsFailed"));
              }
            } : undefined}
          >
            {tVis(workbook.visibility || "public")}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("answerCount", { count: workbook.answer_coverage })} / {t("explanationCount", { count: workbook.explanation_coverage })}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button asChild variant="outline" className="flex-1">
          <Link href="/parent/workbooks">{t("list")}</Link>
        </Button>
        {isOwner && (
          <Button asChild className="flex-1">
            <Link href={`/parent/scan?workbook_id=${workbookId}`}>
              {t("addAnswer")}
            </Link>
          </Button>
        )}
      </div>

      {/* Disputes — link to dedicated page */}
      {disputes.length > 0 && (
        <Link href="/parent/disputes">
          <div className="flex items-center justify-between rounded-lg bg-orange-50 px-3 py-2.5 transition-colors hover:bg-orange-100">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-orange-700">{t("disputeLink")}</span>
              <Badge variant="destructive" className="text-xs">
                {t("disputeCount", { count: disputes.length })}
              </Badge>
            </div>
            <span className="text-xs text-orange-600">{t("disputeManageLink")}</span>
          </div>
        </Link>
      )}

      {/* Student Assignment Section — owner only */}
      {isOwner && <div className="space-y-2">
        <button
          onClick={handleOpenAssign}
          className="flex w-full items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5 text-left transition-colors hover:bg-gray-100"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t("studentAssignment")}</span>
            <Badge variant="secondary" className="text-xs">
              {t("studentCount", { count: assignedStudents.length })}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {showAssignSection ? tCommon("collapse") : tCommon("expand")}
          </span>
        </button>

        {showAssignSection && (
          <div className="space-y-2 pl-1">
            {/* Assigned students */}
            {assignedStudents.length === 0 ? (
              <p className="py-2 text-center text-xs text-muted-foreground">
                {t("noAssignedStudents")}
              </p>
            ) : (
              assignedStudents.map((s) => (
                <div
                  key={s.uid}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {s.display_name || tCommon("noName")}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive shrink-0 text-xs"
                    onClick={() => handleUnassign(s.uid)}
                    disabled={assignLoading}
                  >
                    {t("unassign")}
                  </Button>
                </div>
              ))
            )}

            {/* Unassigned students (available to assign) */}
            {(() => {
              const assignedUids = new Set(assignedStudents.map((s) => s.uid));
              const unassigned = allStudents.filter((s) => !assignedUids.has(s.uid));
              if (allStudents.length === 0) return null;
              if (unassigned.length === 0) {
                return (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    {t("allStudentsAssigned")}
                  </p>
                );
              }
              return unassigned.map((s) => (
                <div
                  key={s.uid}
                  className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{s.display_name || tCommon("noName")}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 text-xs"
                    onClick={() => handleAssign(s.uid)}
                    disabled={assignLoading}
                  >
                    {assignLoading ? "..." : t("assign")}
                  </Button>
                </div>
              ));
            })()}
          </div>
        )}
      </div>}

      {/* OCR loading overlay */}
      {ocrLoading && (
        <div className="flex items-center gap-2 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-700">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          {t("ocrExtracting")}
        </div>
      )}

      {/* Answer keys list — grouped by page */}
      {answerKeys.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("noAnswerKeys")}
        </p>
      ) : (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            {t("answerKeyList", { count: answerKeys.length })}
          </h4>

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
                      const kid = keyId(key);
                      const isEditingAns = editingKey === kid;
                      const expSec = expandedSection?.id === kid ? expandedSection : null;

                      return (
                        <AnswerKeyCard
                          key={kid}
                          entry={key}
                          id={kid}
                          expandedSection={expSec}
                          stats={(() => {
                            const s = problemStats[`${key.page}_${key.number}`];
                            if (totalAssigned === 0 && !s) return null;
                            return {
                              correct: s?.correct || 0,
                              wrong: s?.wrong || 0,
                              coached: s?.coached || 0,
                              mastered: s?.mastered || 0,
                            };
                          })()}
                          isOwner={isOwner}
                          showSaved={savedKey === kid}
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
                            diagram: diagramLoading === kid,
                            convertText: convertingToText === kid,
                            replaceImage: replacingImageId === kid,
                          }}
                          callbacks={{
                            onToggleSection: (s) => toggleSection(key, s),
                            onSetExpanded: (s, editing) => setExpandedSection({ id: kid, section: s, editing }),
                            onDelete: () => handleDeleteAnswerKey(key),
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
                              setEditingKey(kid);
                              setEditAnswer(latexToPlainLocal(key.final_answer));
                              setExpandedSection({ id: kid, section: "answer", editing: true });
                            },
                            onSaveProblem: () => handleSaveProblemWithConvert(key),
                            onStartEditProblem: () => startEditProblemPlain(key),
                            onClearProblem: () => handleClearProblem(key),
                            onSaveExplanation: () => handleSaveExplanation(key),
                            onStartEditExplanation: () => startEditSection(key, "explanation"),
                            onClearExplanation: () => handleClearExplanation(key),
                            onToggleFlag: (flag) => handleToggleFlag(key, flag),
                            onOcr: (section) => triggerOcr(key, section),
                            onRegenDiagram: () => handleRegenerateDiagram(key),
                            onRevertToDiagram: () => handleRevertToDiagram(key),
                            onConvertToText: () => handleConvertToText(key),
                            onOpenImageCropper: () => openImageCropper(key),
                          }}
                        />
                      );
                    })}

                    {/* Add problem button & form — owner only */}
                    {isOwner && addingInPage === pg ? (
                      <div className="rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                        <p className="text-xs font-bold text-indigo-700">{t("addProblemTitle")}</p>
                        <div className="flex items-center gap-2">
                          <div className="w-16">
                            <label className="text-[10px] text-muted-foreground">{t("numberLabel")}</label>
                            <Input
                              type="number"
                              value={addForm.number}
                              onChange={(e) => setAddForm((p) => ({ ...p, number: e.target.value }))}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground">{t("answerLabel")}</label>
                            <Input
                              value={addForm.answer}
                              onChange={(e) => setAddForm((p) => ({ ...p, answer: e.target.value }))}
                              className="h-8 text-sm"
                              placeholder={t("answerInputPlaceholder")}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-muted-foreground">{t("problemOptional")}</label>
                            <button
                              onClick={() => handleMathConvert("problem")}
                              disabled={converting === "problem" || !addForm.problem.trim()}
                              className="text-[10px] text-indigo-600 hover:text-indigo-800 disabled:text-gray-400"
                            >
                              {converting === "problem" ? tCommon("converting") : t("mathConvert")}
                            </button>
                          </div>
                          <textarea
                            value={addForm.problem}
                            onChange={(e) => setAddForm((p) => ({ ...p, problem: e.target.value }))}
                            rows={2}
                            className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-xs"
                            placeholder="x^2 + 3x = 0을 풀어라 (수식 변환 버튼으로 LaTeX 자동 변환)"
                          />
                          {addForm.problem && (
                            <div className="mt-1 rounded bg-white p-1.5 text-xs text-gray-700">
                              <MathText>{addForm.problem}</MathText>
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-muted-foreground">{t("stepsOptional")}</label>
                            <button
                              onClick={() => handleMathConvert("steps")}
                              disabled={converting === "steps" || !addForm.steps.trim()}
                              className="text-[10px] text-indigo-600 hover:text-indigo-800 disabled:text-gray-400"
                            >
                              {converting === "steps" ? tCommon("converting") : t("mathConvert")}
                            </button>
                          </div>
                          <textarea
                            value={addForm.steps}
                            onChange={(e) => setAddForm((p) => ({ ...p, steps: e.target.value }))}
                            rows={2}
                            className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-xs"
                            placeholder="1단계: ...&#10;2단계: ..."
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-muted-foreground">{t("mistakesOptional")}</label>
                            <button
                              onClick={() => handleMathConvert("pitfalls")}
                              disabled={converting === "pitfalls" || !addForm.pitfalls.trim()}
                              className="text-[10px] text-indigo-600 hover:text-indigo-800 disabled:text-gray-400"
                            >
                              {converting === "pitfalls" ? tCommon("converting") : t("mathConvert")}
                            </button>
                          </div>
                          <textarea
                            value={addForm.pitfalls}
                            onChange={(e) => setAddForm((p) => ({ ...p, pitfalls: e.target.value }))}
                            rows={1}
                            className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-xs"
                            placeholder={t("pitfallPlaceholder")}
                          />
                        </div>
                        {/* 문제 이미지 업로드 */}
                        <div>
                          <label className="text-[10px] text-muted-foreground">{t("problemImage")}</label>
                          <input
                            ref={addImageRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleAddFormImage}
                          />
                          <div className="mt-0.5 flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={addImageUploading}
                              onClick={() => addImageRef.current?.click()}
                            >
                              {addImageUploading ? tCommon("uploading") : addForm.problemImageUrl ? t("imageChange") : t("imageAdd")}
                            </Button>
                            {addForm.problemImageUrl && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-red-500"
                                onClick={() => setAddForm((p) => ({ ...p, problemImageUrl: null, imageDependent: false, verifyEnabled: true }))}
                              >
                                {t("imageRemove")}
                              </Button>
                            )}
                          </div>
                          {addForm.problemImageUrl && (
                            <img
                              src={addForm.problemImageUrl}
                              alt={t("imagePreviewAlt")}
                              className="mt-1 max-h-32 rounded-md border"
                            />
                          )}
                          {addForm.imageDependent && (
                            <p className="mt-1 rounded bg-orange-50 px-2 py-1 text-[10px] text-orange-700">
                              {tRoot("problemImageWarning")}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1 text-[10px]">
                            <input
                              type="checkbox"
                              checked={addForm.reviewEnabled}
                              onChange={(e) => setAddForm((p) => ({ ...p, reviewEnabled: e.target.checked }))}
                              className="h-3.5 w-3.5"
                            />
                            <span className="font-bold text-sky-600">R</span> {t("reviewLabel")}
                          </label>
                          <label className="flex items-center gap-1 text-[10px]">
                            <input
                              type="checkbox"
                              checked={addForm.verifyEnabled}
                              disabled={addForm.imageDependent}
                              onChange={(e) => setAddForm((p) => ({ ...p, verifyEnabled: e.target.checked }))}
                              className="h-3.5 w-3.5"
                            />
                            <span className={`font-bold ${addForm.imageDependent ? "text-gray-300" : "text-sky-600"}`}>C</span> {t("verifyLabel")}
                            {addForm.imageDependent && (
                              <span className="text-[9px] text-orange-500">{t("imageDependentShort")}</span>
                            )}
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={addSaving || !addForm.answer.trim() || !addForm.number}
                            onClick={() => handleAddProblem(pg)}
                            className="h-8 bg-indigo-600 px-4 text-xs text-white hover:bg-indigo-700"
                          >
                            {addSaving ? t("adding") : t("add")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs"
                            onClick={() => setAddingInPage(null)}
                          >
                            {tCommon("cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : isOwner ? (
                      <button
                        onClick={() => handleOpenAddForm(pg)}
                        className="flex w-full items-center justify-center rounded-lg border-2 border-dashed border-gray-200 py-2 text-xs text-gray-400 transition-colors hover:border-indigo-300 hover:text-indigo-600"
                      >
                        {t("addProblemButton")}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Fork — non-owner only */}
      {!isOwner && (
        <Button
          onClick={async () => {
            if (!confirm(tRoot("parent.forkConfirm", { label: workbook.label }))) return;
            try {
              const forked = await forkWorkbook(workbookId);
              router.push(`/parent/workbook/${forked.workbook_id}`);
            } catch (err) {
              setError(err instanceof Error ? err.message : tRoot("parent.forkFailed"));
            }
          }}
          className="w-full"
        >
          {tRoot("parent.forkButton")}
        </Button>
      )}

      {/* Delete — owner only */}
      {isOwner && (
        <Button
          variant="destructive"
          onClick={handleDelete}
          disabled={deleting}
          className="w-full"
        >
          {deleting ? tCommon("deleting") : t("deleteWorkbook")}
        </Button>
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
