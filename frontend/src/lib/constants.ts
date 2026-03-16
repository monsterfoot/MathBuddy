/** Central constants for the frontend — no inline hardcoding. */

/** Firebase client config (public keys only — safe to commit). */
export const FIREBASE_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
} as const;

/** localStorage keys. */
export const STORAGE_KEYS = {
  LOCALE: "math-coach-locale",
} as const;

/** Auth configuration. */
export const AUTH = {
  /** Token refresh interval in ms (50 min — tokens expire at 60). */
  TOKEN_REFRESH_INTERVAL_MS: 50 * 60 * 1000,
} as const;

/** Lazy backend URL — resolved at call time to avoid SSR/client mismatch. */
export function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === "undefined") return "http://localhost:8000";
  const proto = window.location.protocol === "https:" ? "https" : "http";
  return `${proto}://${window.location.hostname}:8000`;
}

export function getWsBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  // Derive from API URL: https://... → wss://...
  const apiUrl = getApiBaseUrl();
  if (apiUrl && !apiUrl.includes("localhost")) {
    return apiUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  }
  if (typeof window === "undefined") return "ws://localhost:8000";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.hostname}:8000`;
}

/** Audio configuration matching Gemini Live API specs. */
export const AUDIO = {
  INPUT_SAMPLE_RATE: 16_000,
  OUTPUT_SAMPLE_RATE: 24_000,
  CHANNELS: 1,
  BIT_DEPTH: 16,
  CHUNK_DURATION_MS: 100,
  /** RMS threshold to send audio — filters silence/echo. Range 0–1. */
  VOLUME_GATE_THRESHOLD: 0,
  /** Higher threshold during AI playback to suppress echo. */
  VOLUME_GATE_PLAYBACK_THRESHOLD: 0,
  /** How long (ms) after last AI audio to keep the higher threshold. */
  PLAYBACK_TAIL_MS: 0,
} as const;

/**
 * Translatable label maps have been moved to i18n message files:
 *   src/messages/ko.json  (conceptTags, problemTypes, errorTags, qualityLabels, etc.)
 * Use useTranslations('conceptTags') etc. from next-intl instead.
 */

/** Study flow modes. */
export const STUDY_MODE = {
  SOLVE: "solve",
  COACHING: "coaching",
  VERIFY: "verify",
} as const;

/** Solve page phases. */
export const SOLVE_PHASE = {
  INPUT: "input",
  PROBLEM_PHOTO: "problem_photo",
  WORK_PHOTO: "work_photo",
  GRADING: "grading",
  RESULT: "result",
} as const;

/** Verify page phases. */
export const VERIFY_PHASE = {
  LOADING: "loading",
  DISPLAY: "display",
  PHOTO: "photo",
  GRADING: "grading",
  RESULT: "result",
} as const;

/** Review page phases. */
export const REVIEW_PHASE = {
  LIST: "list",
  LOADING_VARIANT: "loading_variant",
  ANSWER: "answer",
  GRADING: "grading",
  RESULT: "result",
  DONE: "done",
} as const;

/** Coaching configuration. */
export const COACHING = {
  MIN_TURNS_FOR_WRONG: 3,
  /** Farewell keywords per locale — triggers coaching end. */
  FAREWELL_KEYWORDS: {
    ko: "코칭을 마칠게요",
    en: "Let's end the coaching",
    fr: "Terminons le coaching",
    es: "Terminemos el coaching",
    de: "Lass uns das Coaching beenden",
    it: "Finiamo il coaching",
    hi: "कोचिंग समाप्त करते हैं",
    zh: "结束辅导吧",
    ja: "コーチングを終わりましょう",
  } as Record<string, string>,
  /** Show "AI not responding" hint after this many ms of silence. */
  SILENCE_TIMEOUT_MS: 15_000,
} as const;

/**
 * Agent state labels moved to i18n: useTranslations('agentStates')
 */

/** RMS audio level visualization config. */
export const RMS_VIS = {
  BAR_COUNT: 5,
  MAX_RMS: 0.15,
  MIN_BAR_HEIGHT: 4,
  MAX_BAR_HEIGHT: 32,
} as const;

/** Scan wizard configuration. */
export const SCAN = {
  POLL_INTERVAL_MS: 2000,
  /** Parallel concurrency — must match backend SCAN_PARALLEL_CONCURRENCY. */
  PARALLEL_CONCURRENCY: 4,
  /** Time per parallel batch (4 pages) in ms. */
  MS_PER_BATCH: 60_000,
  /** Extra time (ms) added for diagram/verify phase. */
  DIAGRAM_EXTRA_MS: 100_000,
  MAX_PROBLEMS: 30,
  CONFIDENCE_WARN_THRESHOLD: 0.7,
  STEPS: ["workbook", "pages", "processing", "verify"] as const,
  /** Step labels moved to i18n: useTranslations('scan.stepLabels') */
  /** Page tags moved to i18n: useTranslations('scan.pageTags') */
  DEFAULT_PAGE_TAGS: ["answer"] as readonly string[],
} as const;

/** SVG Diagram configuration. */
export const DIAGRAM = {
  /** Regex pattern matching [그림: ...] or [Diagram: ...] markers. Supports both legacy Korean and new English format. */
  PATTERN: /\[(?:그림|[Dd]iagram):\s*([^\]]+)\]/g,
  /** Max SVG string length to accept on client side. */
  MAX_SIZE_CHARS: 60_000,
} as const;

/**
 * Problem image upload warning moved to i18n: useTranslations('problemImageWarning')
 */

/** KaTeX rendering options. */
export const KATEX_OPTIONS = {
  throwOnError: false,
  strict: false,
  trust: true,
  /** Macros for frequently used shortcuts. */
  macros: {} as Record<string, string>,
} as const;

/** Grading configuration. */
export const GRADING = {
  /** Slow warning threshold in ms — show warning after this. */
  SLOW_THRESHOLD_MS: 180_000,
} as const;

/** Study status → Tailwind class mapping for problem grid buttons. */
export const STUDY_STATUS_COLORS: Record<string, string> = {
  correct: "bg-green-100 text-green-800",
  wrong: "bg-rose-100 text-rose-800",
  coached: "bg-amber-100 text-amber-800",
  mastered: "bg-blue-100 text-blue-800",
  disputed: "bg-gray-200 text-gray-600",
  regen_pending: "bg-gray-200 text-gray-600",
};

/** Statuses that lock problems from further solving. */
export const LOCKED_STATUSES = ["correct", "mastered", "disputed", "regen_pending"] as const;

/**
 * Dispute source labels moved to i18n: useTranslations('disputeSources')
 */

/** Audio test page — slider ranges and demo config. */
export const AUDIO_TEST = {
  THRESHOLD_MIN: 0,
  THRESHOLD_MAX: 0.05,
  THRESHOLD_STEP: 0.001,
  PLAYBACK_THRESHOLD_MIN: 0,
  PLAYBACK_THRESHOLD_MAX: 0.1,
  PLAYBACK_THRESHOLD_STEP: 0.001,
  TAIL_MS_MIN: 0,
  TAIL_MS_MAX: 2000,
  TAIL_MS_STEP: 50,
  /** Visual RMS meter scale max. */
  RMS_METER_MAX: 0.15,
  DEMO_IDS: ["demo_1", "demo_2", "demo_3"] as readonly string[],
  DEMO_LABELS: {
    demo_1: "(-5)+(-8)",
    demo_2: "(-9)+7",
    demo_3: "(-3/8)÷(1/2)",
  } as Record<string, string>,
} as const;
