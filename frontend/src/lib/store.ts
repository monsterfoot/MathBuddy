/** Global state using Zustand — manages 3-mode study flow + auth + locale. */

import { create } from "zustand";

import type { GradeResult, MistakeCard, ReviewResult, TeacherLink, VariantResult } from "./api";
import { SOLVE_PHASE, STORAGE_KEYS, STUDY_MODE, VERIFY_PHASE } from "./constants";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../i18n";
import type { SupportedLocale } from "../i18n";

function getSavedLocale(): SupportedLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const saved = localStorage.getItem(STORAGE_KEYS.LOCALE);
  if (saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved)) {
    return saved as SupportedLocale;
  }
  // Auto-detect: Korean browser → ko, everything else → en
  const browserLang = navigator.language ?? "";
  return browserLang.startsWith("ko") ? "ko" : "en";
}

type StudyMode = (typeof STUDY_MODE)[keyof typeof STUDY_MODE];
type SolvePhase = (typeof SOLVE_PHASE)[keyof typeof SOLVE_PHASE];
type VerifyPhase = (typeof VERIFY_PHASE)[keyof typeof VERIFY_PHASE];

export interface UserProfile {
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

export interface VerifyContext {
  variant_display_text: string;
  variant_correct_answer: string;
  variant_student_answer: string;
}

interface AppState {
  // --- Locale ---
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;

  // --- Auth ---
  currentUser: UserProfile | null;
  setCurrentUser: (user: UserProfile | null) => void;
  idToken: string | null;
  setIdToken: (token: string | null) => void;
  forceRefreshToken: (() => Promise<boolean>) | null;
  setForceRefreshToken: (fn: (() => Promise<boolean>) | null) => void;

  // --- Teacher links ---
  teacherLinks: TeacherLink[];
  setTeacherLinks: (links: TeacherLink[]) => void;
  hasTeachers: boolean;

  // --- Global ---
  workbookId: string | null;
  setWorkbookId: (id: string | null) => void;
  isSoloStudy: boolean;
  setIsSoloStudy: (solo: boolean) => void;
  parentUnlocked: boolean;
  unlockParent: () => void;
  lockParent: () => void;

  // --- Study flow ---
  mode: StudyMode;
  setMode: (mode: StudyMode) => void;

  // Current problem
  currentPage: number;
  currentNumber: number;
  setCurrentProblem: (page: number, number: number) => void;

  // Solve phase
  solvePhase: SolvePhase;
  setSolvePhase: (phase: SolvePhase) => void;
  problemPhoto: File | null;
  setProblemPhoto: (file: File | null) => void;
  workPhoto: File | null;
  setWorkPhoto: (file: File | null) => void;
  gradeResult: GradeResult | null;
  setGradeResult: (result: GradeResult | null) => void;
  currentDiagramSvg: string | null;
  setCurrentDiagramSvg: (svg: string | null) => void;

  // Coaching state
  currentAttemptId: string | null;
  setCurrentAttemptId: (id: string | null) => void;
  coachingComplete: boolean;
  setCoachingComplete: (complete: boolean) => void;
  coachingTurnCount: number;
  setCoachingTurnCount: (count: number) => void;
  wasCorrectEntry: boolean;
  setWasCorrectEntry: (correct: boolean) => void;

  // Verify state
  verifyPhase: VerifyPhase;
  setVerifyPhase: (phase: VerifyPhase) => void;
  variantProblem: VariantResult | null;
  setVariantProblem: (variant: VariantResult | null) => void;
  verifyWorkPhoto: File | null;
  setVerifyWorkPhoto: (file: File | null) => void;

  // Retry coaching context (from last verify failure)
  lastVerifyContext: VerifyContext | null;
  setLastVerifyContext: (ctx: VerifyContext | null) => void;

  // --- Review session (persists across coach navigation) ---
  reviewCards: MistakeCard[];
  reviewCardIdx: number;
  reviewSm2Done: boolean;
  reviewCorrectCount: number;
  reviewFirstResult: ReviewResult | null;
  reviewFromCoaching: boolean;
  setReviewCards: (cards: MistakeCard[]) => void;
  setReviewCardIdx: (idx: number) => void;
  setReviewSm2Done: (done: boolean) => void;
  setReviewCorrectCount: (count: number) => void;
  setReviewFirstResult: (result: ReviewResult | null) => void;
  setReviewFromCoaching: (from: boolean) => void;
  clearReviewSession: () => void;

  // Actions
  resetToSolve: () => void;
  resetFlow: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  // --- Locale ---
  locale: getSavedLocale(),
  setLocale: (locale) => {
    localStorage.setItem(STORAGE_KEYS.LOCALE, locale);
    set({ locale });
  },

  // --- Auth ---
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),
  idToken: null,
  setIdToken: (token) => set({ idToken: token }),
  forceRefreshToken: null,
  setForceRefreshToken: (fn) => set({ forceRefreshToken: fn }),

  // --- Teacher links ---
  teacherLinks: [],
  setTeacherLinks: (links) => set({ teacherLinks: links, hasTeachers: links.length > 0 }),
  hasTeachers: false,

  // --- Global ---
  workbookId: null,
  setWorkbookId: (id) => set({ workbookId: id }),
  isSoloStudy: false,
  setIsSoloStudy: (solo) => set({ isSoloStudy: solo }),
  parentUnlocked: false,
  unlockParent: () => set({ parentUnlocked: true }),
  lockParent: () => set({ parentUnlocked: false }),

  // --- Study flow ---
  mode: STUDY_MODE.SOLVE,
  setMode: (mode) => set({ mode }),

  // Current problem
  currentPage: 1,
  currentNumber: 1,
  setCurrentProblem: (page, number) =>
    set({ currentPage: page, currentNumber: number }),

  // Solve phase
  solvePhase: SOLVE_PHASE.INPUT,
  setSolvePhase: (phase) => set({ solvePhase: phase }),
  problemPhoto: null,
  setProblemPhoto: (file) => set({ problemPhoto: file }),
  workPhoto: null,
  setWorkPhoto: (file) => set({ workPhoto: file }),
  gradeResult: null,
  setGradeResult: (result) => set({ gradeResult: result }),
  currentDiagramSvg: null,
  setCurrentDiagramSvg: (svg) => set({ currentDiagramSvg: svg }),

  // Coaching state
  currentAttemptId: null,
  setCurrentAttemptId: (id) => set({ currentAttemptId: id }),
  coachingComplete: false,
  setCoachingComplete: (complete) => set({ coachingComplete: complete }),
  coachingTurnCount: 0,
  setCoachingTurnCount: (count) => set({ coachingTurnCount: count }),
  wasCorrectEntry: false,
  setWasCorrectEntry: (correct) => set({ wasCorrectEntry: correct }),

  // Verify state
  verifyPhase: VERIFY_PHASE.LOADING,
  setVerifyPhase: (phase) => set({ verifyPhase: phase }),
  variantProblem: null,
  setVariantProblem: (variant) => set({ variantProblem: variant }),
  verifyWorkPhoto: null,
  setVerifyWorkPhoto: (file) => set({ verifyWorkPhoto: file }),

  // Retry coaching context
  lastVerifyContext: null,
  setLastVerifyContext: (ctx) => set({ lastVerifyContext: ctx }),

  // Review session
  reviewCards: [],
  reviewCardIdx: 0,
  reviewSm2Done: false,
  reviewCorrectCount: 0,
  reviewFirstResult: null,
  reviewFromCoaching: false,
  setReviewCards: (cards) => set({ reviewCards: cards }),
  setReviewCardIdx: (idx) => set({ reviewCardIdx: idx }),
  setReviewSm2Done: (done) => set({ reviewSm2Done: done }),
  setReviewCorrectCount: (count) => set({ reviewCorrectCount: count }),
  setReviewFirstResult: (result) => set({ reviewFirstResult: result }),
  setReviewFromCoaching: (from) => set({ reviewFromCoaching: from }),
  clearReviewSession: () =>
    set({
      reviewCards: [],
      reviewCardIdx: 0,
      reviewSm2Done: false,
      reviewCorrectCount: 0,
      reviewFirstResult: null,
      reviewFromCoaching: false,
    }),

  // Actions
  resetToSolve: () =>
    set({
      mode: STUDY_MODE.SOLVE,
      solvePhase: SOLVE_PHASE.INPUT,
      problemPhoto: null,
      workPhoto: null,
      gradeResult: null,
      currentDiagramSvg: null,
      currentAttemptId: null,
      coachingComplete: false,
      coachingTurnCount: 0,
      wasCorrectEntry: false,
      verifyPhase: VERIFY_PHASE.LOADING,
      variantProblem: null,
      verifyWorkPhoto: null,
      lastVerifyContext: null,
    }),

  resetFlow: () =>
    set({
      mode: STUDY_MODE.SOLVE,
      solvePhase: SOLVE_PHASE.INPUT,
      currentPage: 1,
      currentNumber: 1,
      problemPhoto: null,
      workPhoto: null,
      gradeResult: null,
      currentDiagramSvg: null,
      currentAttemptId: null,
      coachingComplete: false,
      coachingTurnCount: 0,
      wasCorrectEntry: false,
      verifyPhase: VERIFY_PHASE.LOADING,
      variantProblem: null,
      verifyWorkPhoto: null,
      lastVerifyContext: null,
    }),
}));
