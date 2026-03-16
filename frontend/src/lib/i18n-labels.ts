/** Helper hooks for looking up i18n-translated label maps (concept tags, error tags, etc.). */

import { useTranslations } from "next-intl";

/** Get a translated concept tag label (e.g. "CALC" → "Numbers & Operations"). */
export function useConceptTagLabel() {
  const t = useTranslations("conceptTags");
  return (tag: string) => {
    try {
      return t(tag);
    } catch {
      return t("unknown");
    }
  };
}

/** Get a translated problem type label (e.g. "choice" → "Multiple Choice"). */
export function useProblemTypeLabel() {
  const t = useTranslations("problemTypes");
  return (type: string) => {
    try {
      return t(type);
    } catch {
      return t("unknown");
    }
  };
}

/** Get a translated error tag label (e.g. "sign_error" → "Sign error"). */
export function useErrorTagLabel() {
  const t = useTranslations("errorTags");
  return (tag: string) => {
    try {
      return t(tag);
    } catch {
      return tag;
    }
  };
}

/** Get a translated SM-2 quality label (e.g. 5 → "Correct without hints"). */
export function useQualityLabel() {
  const t = useTranslations("qualityLabels");
  return (quality: number) => {
    try {
      return t(String(quality));
    } catch {
      return String(quality);
    }
  };
}

/** Get a translated agent state label (e.g. "idle" → "Idle"). */
export function useAgentStateLabel() {
  const t = useTranslations("agentStates");
  return (state: string) => {
    try {
      return t(state);
    } catch {
      return state;
    }
  };
}

/** Get a translated dispute source label (e.g. "solve" → "Problem solving"). */
export function useDisputeSourceLabel() {
  const t = useTranslations("disputeSources");
  return (source: string) => {
    try {
      return t(source);
    } catch {
      return source;
    }
  };
}
