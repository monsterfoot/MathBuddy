/** Backend API client — thin wrappers around fetch. */

import { getApiBaseUrl } from "./constants";
import { useAppStore } from "./store";

/** Build auth + locale headers from current Zustand state. */
function authHeaders(): Record<string, string> {
  const { idToken, locale } = useAppStore.getState();
  const headers: Record<string, string> = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  if (locale) headers["X-Locale"] = locale;
  return headers;
}

/** In-memory cache for signed URLs (gcs path → {url, expiresAt}). */
const _signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_CACHE_MS = 50 * 60 * 1000; // 50 min (URLs expire at 60 min)

/**
 * Resolve a GCS `gs://` path to a browser-accessible signed URL.
 * Returns the original URL if it's not a GCS path.
 * Uses an in-memory cache to avoid redundant backend calls.
 */
export async function fetchSignedImageUrl(gcsPath: string | null | undefined): Promise<string | null> {
  if (!gcsPath) return null;
  if (!gcsPath.startsWith("gs://")) return gcsPath;

  // Check cache
  const cached = _signedUrlCache.get(gcsPath);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  try {
    const data = await request<{ url: string }>(
      `/api/signed-image-url?path=${encodeURIComponent(gcsPath)}`
    );
    _signedUrlCache.set(gcsPath, { url: data.url, expiresAt: Date.now() + SIGNED_URL_CACHE_MS });
    return data.url;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const doFetch = async () => {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...options?.headers,
      },
    });
    return res;
  };

  // Pre-flight: wait for auth token if not yet available
  if (!useAppStore.getState().idToken) {
    // Wait up to 3s for AuthProvider to set the token
    for (let i = 0; i < 30 && !useAppStore.getState().idToken; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    // If still no token, try force-refresh as last resort
    if (!useAppStore.getState().idToken) {
      const forceRefresh = useAppStore.getState().forceRefreshToken;
      if (forceRefresh) await forceRefresh();
    }
  }

  let res = await doFetch();

  // Auto-retry on 401: force-refresh token and try once more
  if (res.status === 401) {
    const forceRefresh = useAppStore.getState().forceRefreshToken;
    if (forceRefresh) {
      const refreshed = await forceRefresh();
      if (refreshed) {
        res = await doFetch();
      }
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    // Enhance 401 error message to suggest re-login
    if (res.status === 401) {
      throw new Error("Session expired. Please refresh the page or sign in again.");
    }
    throw new Error(error.detail || `API error: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Fetch with FormData (no Content-Type — browser sets boundary) + auth headers. */
async function fetchWithAuth(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

// --- Workbooks ---

export type WorkbookVisibility = "public" | "private" | "for_sale" | "purchased" | "copied";

export interface Workbook {
  workbook_id: string;
  label: string;
  status: "draft" | "locked";
  visibility: WorkbookVisibility;
  owner_uid?: string | null;
  cover_photo_url: string | null;
  problem_count: number;
  answer_coverage: number;
  explanation_coverage: number;
  created_at: string;
  locked_at: string | null;
}

export function listWorkbooks(teacherUid?: string) {
  const params = teacherUid ? `?teacher_uid=${encodeURIComponent(teacherUid)}` : "";
  return request<Workbook[]>(`/api/workbooks${params}`);
}

export function getWorkbook(id: string) {
  return request<Workbook>(`/api/workbooks/${id}`);
}

export function createWorkbook(label: string, visibility: WorkbookVisibility = "public") {
  return request<Workbook>("/api/workbooks", {
    method: "POST",
    body: JSON.stringify({ label, visibility }),
  });
}

export function updateWorkbook(id: string, data: { label?: string; visibility?: WorkbookVisibility }) {
  return request<Workbook>(`/api/workbooks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteWorkbook(id: string) {
  return request<void>(`/api/workbooks/${id}`, { method: "DELETE" });
}

export function forkWorkbook(id: string) {
  return request<Workbook>(`/api/workbooks/${id}/fork`, { method: "POST" });
}

export function getWorkbookAnswerKeys(workbookId: string) {
  return request<{ answer_keys: AnswerKeyEntry[] }>(
    `/api/workbooks/${workbookId}/answer-keys`
  );
}

export function editWorkbookAnswerKey(
  workbookId: string,
  page: number,
  number: number,
  data: Partial<Pick<AnswerKeyEntry, "final_answer" | "answer_type" | "concept_tag" | "problem_type" | "solution_steps" | "pitfalls" | "source_page_start" | "source_page_end" | "problem_description" | "diagram_svg" | "image_dependent" | "problem_image_url" | "review_enabled" | "verify_enabled">>
) {
  return request<AnswerKeyEntry>(
    `/api/workbooks/${workbookId}/answer-key/${page}/${number}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    }
  );
}

export function addWorkbookAnswerKey(
  workbookId: string,
  data: {
    page: number;
    number: number;
    final_answer: string;
    problem_description?: string | null;
    solution_steps?: string[];
    pitfalls?: string[];
    image_dependent?: boolean;
    problem_image_url?: string | null;
    review_enabled?: boolean;
    verify_enabled?: boolean;
  },
) {
  return request<AnswerKeyEntry>(
    `/api/workbooks/${workbookId}/answer-key`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  );
}

export function convertMathText(workbookId: string, text: string) {
  return request<{ converted: string }>(
    `/api/workbooks/${workbookId}/math-convert`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
    },
  );
}

export function regenerateDiagram(
  workbookId: string,
  page: number,
  number: number,
) {
  return request<AnswerKeyEntry>(
    `/api/workbooks/${workbookId}/answer-key/${page}/${number}/regenerate-diagram`,
    { method: "POST" },
  );
}

export function latexToPlain(workbookId: string, text: string) {
  return request<{ plain: string }>(
    `/api/workbooks/${workbookId}/latex-to-plain`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
    },
  );
}

export function convertToTextChoice(
  workbookId: string,
  page: number,
  number: number,
) {
  return request<AnswerKeyEntry>(
    `/api/workbooks/${workbookId}/answer-key/${page}/${number}/convert-to-text`,
    { method: "POST" },
  );
}

export async function uploadProblemImageForAdd(
  workbookId: string,
  file: File,
): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetchWithAuth(
    `${getApiBaseUrl()}/api/workbooks/${workbookId}/upload-problem-image`,
    { method: "POST", body: form },
  );
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `Upload failed: ${res.status}`);
  }
  return res.json();
}

// --- Workbook Assignment ---

export interface AssignedStudent {
  uid: string;
  email: string;
  display_name: string;
  photo_url: string | null;
}

export function assignStudent(workbook_id: string, student_uid: string) {
  return request<{ assigned: boolean; student_uid: string }>(
    `/api/workbooks/${workbook_id}/assign`,
    {
      method: "POST",
      body: JSON.stringify({ student_uid }),
    },
  );
}

export function unassignStudent(workbook_id: string, student_uid: string) {
  return request<{ unassigned: boolean; student_uid: string }>(
    `/api/workbooks/${workbook_id}/assign/${student_uid}`,
    { method: "DELETE" },
  );
}

export function getWorkbookAssignments(workbook_id: string) {
  return request<{ students: AssignedStudent[]; count: number }>(
    `/api/workbooks/${workbook_id}/assignments`,
  );
}

export interface ProblemStats {
  [key: string]: { correct: number; wrong: number; coached: number; mastered: number };
}

export function getWorkbookStats(workbook_id: string) {
  return request<{ workbook_id: string; problem_stats: ProblemStats; total_assigned: number }>(
    `/api/workbooks/${workbook_id}/stats`,
  );
}

// --- User ---

export interface UserProfileResponse {
  uid: string;
  email: string;
  display_name: string;
  photo_url: string | null;
  role: "admin" | "student";
  tier: "free" | "premium";
  admin_email: string | null;
  admin_uid: string | null;
  approved: boolean;
}

export function getMyProfile() {
  return request<UserProfileResponse>("/api/users/me");
}

export function getMyStudents() {
  return request<{ students: UserProfileResponse[]; count: number }>(
    "/api/users/students",
  );
}

// --- Student Dashboard (Admin) ---

export interface WorkbookProgress {
  workbook_id: string;
  label: string;
  total: number;
  correct: number;
  wrong: number;
  mastered: number;
}

export interface StudentReviewStats {
  student_uid: string;
  total_cards: number;
  due_cards: number;
}

export interface RecentAttempt {
  attempt_id: string;
  workbook_id: string;
  page: number;
  number: number;
  is_correct: boolean;
  student_answer: string | null;
  correct_answer: string;
  error_tag: string | null;
  concept_tag: string;
  problem_type?: string;
  created_at: string;
}

export function getStudentWorkbookProgress(student_uid: string) {
  return request<{ student_uid: string; workbooks: WorkbookProgress[] }>(
    `/api/users/students/${student_uid}/workbook-progress`,
  );
}

export function getStudentReviewStats(student_uid: string) {
  return request<StudentReviewStats>(
    `/api/users/students/${student_uid}/review-stats`,
  );
}

export function getStudentRecentActivity(student_uid: string, limit = 20) {
  return request<{ student_uid: string; attempts: RecentAttempt[]; count: number }>(
    `/api/users/students/${student_uid}/recent-activity?limit=${limit}`,
  );
}

// --- Study / Grading ---

export interface GradeResult {
  attempt_id: string;
  is_correct: boolean;
  student_answer: string | null;
  correct_answer: string;
  concept_tag: string;
  problem_type?: string;
  error_tag: string | null;
  feedback: string;
  problem_photo_url?: string | null;
  work_photo_url?: string | null;
  problem_description?: string | null;
}

export async function gradeSubmission(
  workbook_id: string,
  page: number,
  number: number,
  workPhoto?: File | null,
  problemPhoto?: File | null,
  studentAnswerText?: string | null,
): Promise<GradeResult> {
  const form = new FormData();
  if (workPhoto) form.append("work_photo", workPhoto);
  if (problemPhoto) form.append("problem_photo", problemPhoto);

  const params = new URLSearchParams({
    workbook_id,
    page: String(page),
    number: String(number),
  });

  if (studentAnswerText) {
    params.set("student_answer_text", studentAnswerText);
  }

  const res = await fetchWithAuth(`${getApiBaseUrl()}/api/study/grade?${params}`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `API error: ${res.status}`);
  }

  return res.json();
}

// --- Next Problem ---

export interface NextProblemResult {
  page: number | null;
  number: number | null;
}

export function getNextProblem(
  workbook_id: string,
  current_page: number,
  current_number: number,
) {
  const params = new URLSearchParams({
    workbook_id,
    current_page: String(current_page),
    current_number: String(current_number),
  });
  return request<NextProblemResult>(
    `/api/study/next-problem?${params}`
  );
}

// --- Mark Coached ---

export function markCoached(workbook_id: string, page: number, number: number) {
  const params = new URLSearchParams({
    workbook_id,
    page: String(page),
    number: String(number),
  });
  return request<{ status: string }>(
    `/api/study/coached?${params}`,
    { method: "POST" },
  );
}

// --- Mark Mastered ---

export function markMastered(workbook_id: string, page: number, number: number) {
  const params = new URLSearchParams({
    workbook_id,
    page: String(page),
    number: String(number),
  });
  return request<{ status: string }>(
    `/api/study/mark-mastered?${params}`,
    { method: "POST" },
  );
}

// --- Variant ---

export interface VariantResult {
  display_text: string;
  correct_answer: string;
  difficulty_band: string;
  diagram_svg?: string | null;
}

export function generateVariant(
  difficulty_band = "medium",
  page = 0,
  number = 0,
  problem_description = "",
  image_dependent = false,
  correct_answer = "",
  workbook_id = "",
  attempt_id = "",
) {
  return request<VariantResult>("/api/study/variant", {
    method: "POST",
    body: JSON.stringify({
      difficulty_band, page, number, problem_description,
      image_dependent, correct_answer, workbook_id, attempt_id,
    }),
  });
}

// --- Verify ---

export interface VerifyResult {
  attempt_id: string;
  is_correct: boolean;
  student_answer: string | null;
  correct_answer: string;
  error_tag: string | null;
  feedback: string;
}

export async function gradeVerification(
  correct_answer: string,
  concept_tag: string,
  original_attempt_id = "",
  workbook_id = "",
  original_page = 0,
  original_number = 0,
  workPhoto?: File | null,
  studentAnswerText?: string | null,
): Promise<VerifyResult> {
  const form = new FormData();
  if (workPhoto) form.append("work_photo", workPhoto);

  const params = new URLSearchParams({
    correct_answer,
    concept_tag,
    original_attempt_id,
    workbook_id,
    original_page: String(original_page),
    original_number: String(original_number),
  });

  if (studentAnswerText) {
    params.set("student_answer_text", studentAnswerText);
  }

  const res = await fetchWithAuth(`${getApiBaseUrl()}/api/study/verify?${params}`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `API error: ${res.status}`);
  }

  return res.json();
}

// --- Review ---

export interface MistakeCard {
  card_id: string;
  concept_tag: string;
  problem_type?: string;
  difficulty_band: string;
  due_at: string;
  ease_factor: number;
  interval: number;
  repetitions: number;
  workbook_id?: string;
  page?: number;
  number?: number;
  problem_description?: string;
  source_attempt_ids?: string[];
  image_dependent?: boolean;
  problem_image_url?: string | null;
  correct_answer?: string;
}

export interface ReviewResult {
  card_id: string;
  is_correct: boolean;
  next_due_at: string;
  quality_score: number;
}

export function getAllReviewCards(student_uid?: string) {
  const params = student_uid ? `?student_uid=${student_uid}` : "";
  return request<{ cards: MistakeCard[]; count: number }>(
    `/api/review/cards${params}`
  );
}

export function deleteReviewCard(card_id: string) {
  return request<{ deleted: boolean; card_id: string }>(
    `/api/review/cards/${card_id}`,
    { method: "DELETE" }
  );
}

export function deleteAllReviewCards(student_uid?: string) {
  const params = student_uid ? `?student_uid=${student_uid}` : "";
  return request<{ deleted_count: number }>(
    `/api/review/cards${params}`,
    { method: "DELETE" }
  );
}

export function getDueCards() {
  return request<{ cards: MistakeCard[]; count: number }>(
    `/api/review/due`
  );
}

export function submitReview(
  card_id: string,
  is_correct: boolean,
  quality_score: number,
) {
  return request<ReviewResult>("/api/review/submit", {
    method: "POST",
    body: JSON.stringify({ card_id, is_correct, quality_score }),
  });
}

// --- Study Records (replaces localStorage problem status) ---

export interface SavedVariant {
  display_text: string;
  correct_answer: string;
}

export interface StudyRecordsResult {
  statuses: Record<string, string>;
  last_attempt_ids: Record<string, string>;
  saved_variants?: Record<string, SavedVariant>;
}

export function getStudyRecords(workbook_id: string) {
  return request<StudyRecordsResult>(
    `/api/study/records?workbook_id=${workbook_id}`
  );
}

// --- Scan ---

export function startScan(workbook_id: string, start_page_index = 1) {
  return request<{ session_id: string; status: string }>("/api/scan/start", {
    method: "POST",
    body: JSON.stringify({ workbook_id, start_page_index }),
  });
}

export async function uploadScanPage(
  sessionId: string,
  file: File,
  pageTags: string[] = ["answer", "explanation"],
) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetchWithAuth(
    `${getApiBaseUrl()}/api/scan/${sessionId}/page?page_tags=${pageTags.join(",")}`,
    { method: "POST", body: form },
  );

  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

export function deleteScanPage(sessionId: string, pageIndex: number) {
  return request<{ pages: { url: string; tags: string[] }[] }>(
    `/api/scan/${sessionId}/page/${pageIndex}`,
    { method: "DELETE" }
  );
}

// --- Scan (Phase 3 additions) ---

export interface ScanStatus {
  session_id: string;
  status: string;
  answers_found: number;
  explanations_found: number;
  problem_descriptions_found: number;
  warnings: string[];
  progress_message: string;
  progress_pct: number;
}

export interface AnswerKeyEntry {
  page: number;
  number: number;
  final_answer: string;
  answer_type: string;
  solution_steps: string[];
  pitfalls: string[];
  concept_tag: string;
  problem_type?: string;
  extraction_confidence: number;
  manually_corrected: boolean;
  source_page_start: number | null;
  source_page_end: number | null;
  problem_description: string | null;
  diagram_svg: string | null;
  source_question_page_url: string | null;
  image_dependent: boolean;
  problem_image_url: string | null;
  review_enabled: boolean;
  verify_enabled: boolean;
}

export function updateScanPageTags(
  sessionId: string,
  pageTags: { index: number; tags: string[] }[],
) {
  return request<{ pages: { url: string; tags: string[] }[] }>(
    `/api/scan/${sessionId}/page-tags`,
    {
      method: "PATCH",
      body: JSON.stringify(pageTags),
    }
  );
}

export function processScan(sessionId: string) {
  return request<ScanStatus>(`/api/scan/${sessionId}/process`, {
    method: "POST",
  });
}

export function getScanStatus(sessionId: string) {
  return request<ScanStatus>(`/api/scan/${sessionId}/status`);
}

export function getAnswerKeys(sessionId: string) {
  return request<{ answer_keys: AnswerKeyEntry[] }>(
    `/api/scan/${sessionId}/answer-keys`
  );
}

export function editAnswerKey(
  sessionId: string,
  page: number,
  number: number,
  data: Partial<Pick<AnswerKeyEntry, "final_answer" | "answer_type" | "concept_tag" | "problem_type" | "solution_steps" | "pitfalls" | "source_page_start" | "source_page_end" | "problem_description" | "diagram_svg" | "image_dependent" | "problem_image_url" | "review_enabled" | "verify_enabled">>
) {
  return request<AnswerKeyEntry>(
    `/api/scan/${sessionId}/answer-key/${page}/${number}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    }
  );
}

export function deleteAnswerKey(sessionId: string, page: number, number: number) {
  return request<{ deleted: string }>(
    `/api/scan/${sessionId}/answer-key/${page}/${number}`,
    { method: "DELETE" }
  );
}

export function regenerateScanDiagram(
  sessionId: string,
  page: number,
  number: number,
) {
  return request<AnswerKeyEntry>(
    `/api/scan/${sessionId}/answer-key/${page}/${number}/regenerate-diagram`,
    { method: "POST" },
  );
}

export async function uploadScanProblemImage(
  sessionId: string,
  file: File,
): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetchWithAuth(
    `${getApiBaseUrl()}/api/scan/${sessionId}/upload-problem-image`,
    { method: "POST", body: form },
  );
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `Upload failed: ${res.status}`);
  }
  return res.json();
}

/** Fetch source question page image as a blob URL (for ImageCropper). */
export async function fetchScanSourceImage(
  sessionId: string,
  page: number,
  number: number,
): Promise<string> {
  const res = await fetchWithAuth(
    `${getApiBaseUrl()}/api/scan/${sessionId}/answer-key/${page}/${number}/source-image`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error("Source image not found");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Fetch source question page image as a blob URL (workbook, for ImageCropper). */
export async function fetchWorkbookSourceImage(
  workbookId: string,
  page: number,
  number: number,
): Promise<string> {
  const res = await fetchWithAuth(
    `${getApiBaseUrl()}/api/workbooks/${workbookId}/answer-key/${page}/${number}/source-image`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error("Source image not found");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function ocrProblemDescription(
  sessionId: string,
  file: File,
): Promise<{ text: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetchWithAuth(
    `${getApiBaseUrl()}/api/scan/${sessionId}/ocr-problem`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error(`OCR failed: ${res.status}`);
  return res.json();
}

export async function ocrExplanation(
  sessionId: string,
  file: File,
): Promise<{ solution_steps: string[]; pitfalls: string[] }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetchWithAuth(
    `${getApiBaseUrl()}/api/scan/${sessionId}/ocr-explanation`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error(`OCR failed: ${res.status}`);
  return res.json();
}

export function cancelScan(sessionId: string) {
  return request<{ status: string }>(
    `/api/scan/${sessionId}/cancel`,
    { method: "POST" }
  );
}

export function lockScan(sessionId: string) {
  return request<{ status: string; workbook_id: string }>(
    `/api/scan/${sessionId}/lock`,
    { method: "POST" }
  );
}

// --- Problem Description (from image upload → OCR) ---

export async function uploadProblemImageForDescription(
  workbookId: string,
  page: number,
  number: number,
  file: File,
): Promise<AnswerKeyEntry> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetchWithAuth(
    `${getApiBaseUrl()}/api/workbooks/${workbookId}/answer-key/${page}/${number}/problem-image`,
    { method: "PUT", body: form },
  );
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || "Upload failed");
  }
  return res.json();
}

export function deleteWorkbookAnswerKey(
  workbookId: string,
  page: number,
  number: number,
) {
  return request<{ deleted: string }>(
    `/api/workbooks/${workbookId}/answer-key/${page}/${number}`,
    { method: "DELETE" },
  );
}

export async function ocrWorkbookExplanation(
  workbookId: string,
  page: number,
  number: number,
  file: File,
): Promise<AnswerKeyEntry> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetchWithAuth(
    `${getApiBaseUrl()}/api/workbooks/${workbookId}/answer-key/${page}/${number}/explanation-image`,
    { method: "PUT", body: form },
  );
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || "OCR failed");
  }
  return res.json();
}

export function deleteProblemDescription(
  workbookId: string,
  page: number,
  number: number,
) {
  return request<AnswerKeyEntry>(
    `/api/workbooks/${workbookId}/answer-key/${page}/${number}/problem-description`,
    { method: "DELETE" },
  );
}

// --- Diagram Test ---

export interface DiagramBounds {
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
}

export interface TestDiagramProblem {
  number: number;
  description: string;
  diagram_description: string | null;
  diagram_svg: string | null;
  diagram_bounds: DiagramBounds | null;
  is_image_interaction: boolean;
  converted_text: string | null;
}

export async function testDiagram(
  file: File,
): Promise<{ problems: TestDiagramProblem[] }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetchWithAuth(
    `${getApiBaseUrl()}/api/scan/test-diagram`,
    { method: "POST", body: form },
  );
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || "Diagram test failed");
  }
  return res.json();
}

// --- Disputes (오채점) ---

export type DisputeSource = "solve" | "verify" | "review";

export interface Dispute {
  dispute_id: string;
  status: "pending" | "accepted" | "rejected";
  student_id: string;
  workbook_id: string;
  workbook_label?: string;
  page: number;
  number: number;
  student_answer: string;
  correct_answer: string;
  problem_description: string;
  source: DisputeSource;
  created_at: string | null;
  resolved_at: string | null;
  admin_note: string | null;
}

export async function createDispute(
  attemptId: string,
  workbookId: string,
  page: number,
  number: number,
  studentAnswer: string,
  correctAnswer: string,
  problemDescription: string,
  source: DisputeSource = "solve",
): Promise<Dispute> {
  return request<Dispute>("/api/study/dispute", {
    method: "POST",
    body: JSON.stringify({
      attempt_id: attemptId,
      workbook_id: workbookId,
      page,
      number,
      student_answer: studentAnswer,
      correct_answer: correctAnswer,
      problem_description: problemDescription,
      source,
    }),
  });
}

export async function listDisputes(
  workbookId: string,
  status: string = "pending",
): Promise<{ disputes: Dispute[] }> {
  return request<{ disputes: Dispute[] }>(
    `/api/workbooks/${workbookId}/disputes?status=${status}`,
  );
}

export async function listAllDisputes(
  status: string = "pending",
): Promise<{ disputes: Dispute[] }> {
  return request<{ disputes: Dispute[] }>(
    `/api/study/disputes?status=${status}`,
  );
}

export async function resolveDispute(
  disputeId: string,
  accepted: boolean,
  adminNote: string = "",
): Promise<Dispute> {
  return request<Dispute>(`/api/study/dispute/${disputeId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ accepted, admin_note: adminNote }),
  });
}

export async function deleteDispute(disputeId: string): Promise<void> {
  await request(`/api/study/dispute/${disputeId}`, { method: "DELETE" });
}

// --- Regen Requests (재출제 요청) ---

export interface RegenRequest {
  request_id: string;
  status: "pending" | "accepted" | "rejected";
  student_id: string;
  card_id: string;
  workbook_id: string;
  workbook_label?: string;
  page: number;
  number: number;
  variant_text: string;
  correct_answer: string;
  problem_description: string;
  created_at: string | null;
  resolved_at: string | null;
  admin_note: string | null;
}

export async function createRegenRequest(
  cardId: string,
  workbookId: string,
  page: number,
  number: number,
  variantText: string,
  correctAnswer: string,
  problemDescription: string,
): Promise<RegenRequest> {
  return request<RegenRequest>("/api/study/regen-request", {
    method: "POST",
    body: JSON.stringify({
      card_id: cardId,
      workbook_id: workbookId,
      page,
      number,
      variant_text: variantText,
      correct_answer: correctAnswer,
      problem_description: problemDescription,
    }),
  });
}

export async function listAllRegenRequests(
  status: string = "pending",
): Promise<{ requests: RegenRequest[] }> {
  return request<{ requests: RegenRequest[] }>(
    `/api/study/regen-requests?status=${status}`,
  );
}

export async function resolveRegenRequest(
  requestId: string,
  accepted: boolean,
  adminNote: string = "",
): Promise<RegenRequest> {
  return request<RegenRequest>(`/api/study/regen-request/${requestId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ accepted, admin_note: adminNote }),
  });
}

export async function deleteRegenRequest(requestId: string): Promise<void> {
  await request(`/api/study/regen-request/${requestId}`, { method: "DELETE" });
}

// --- Teacher-Student Links ---

export interface TeacherLink {
  teacher_uid: string;
  teacher_email: string;
  teacher_display_name: string;
}

export async function getMyTeachers(): Promise<TeacherLink[]> {
  const res = await request<{ teachers: TeacherLink[]; count: number }>(
    "/api/teachers/my-teachers",
  );
  return res.teachers;
}

export async function joinTeacher(teacherEmail: string): Promise<TeacherLink> {
  const res = await request<Record<string, string>>("/api/teachers/join", {
    method: "POST",
    body: JSON.stringify({ teacher_email: teacherEmail }),
  });
  return {
    teacher_uid: res.teacher_uid,
    teacher_email: res.teacher_email,
    teacher_display_name: res.teacher_display_name,
  };
}

export async function leaveTeacher(teacherUid: string): Promise<void> {
  await request(`/api/teachers/${teacherUid}`, { method: "DELETE" });
}

export async function removeStudent(studentUid: string): Promise<void> {
  await request("/api/teachers/remove-student", {
    method: "POST",
    body: JSON.stringify({ student_uid: studentUid }),
  });
}

// --- Coaching ticket ---

/** Obtain a short-lived ticket for WebSocket coaching auth. */
export async function fetchCoachingTicket(): Promise<string> {
  const data = await request<{ ticket: string }>("/ws/coach/ticket", {
    method: "POST",
  });
  return data.ticket;
}
