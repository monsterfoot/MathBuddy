/** Shared TypeScript types. */

export interface ProblemKey {
  workbook_id: string;
  page: number;
  number: number;
}

export interface TranscriptEntry {
  role: "user" | "agent";
  text: string;
  timestamp: number;
  finished?: boolean;
}

export interface VariantProblem {
  template_id: string;
  display_text: string;
  correct_answer: string;
  difficulty_band: "easy" | "medium" | "hard";
}
