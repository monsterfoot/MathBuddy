"use client";

import { useEffect, useMemo, useState } from "react";
import katex from "katex";
import { DIAGRAM, KATEX_OPTIONS } from "@/lib/constants";
import { fetchSignedImageUrl } from "@/lib/api";
import { useTranslations } from "next-intl";

interface MathTextProps {
  children: string;
  className?: string;
  /** Render as block-level element instead of inline span. */
  as?: "p" | "span" | "div";
  /** Optional SVG diagram string for [그림: ...] markers. */
  diagramSvg?: string | null;
  /** Optional problem image URL for image-dependent problems. */
  problemImageUrl?: string | null;
}

/**
 * Renders mixed Korean text + LaTeX math expressions using KaTeX.
 *
 * - `$...$`  → inline math
 * - `$$...$$` → display (block) math
 * - Plain text without `$` → rendered as-is (backward compatible)
 */
export function MathText({
  children,
  className = "",
  as: Tag = "span",
  diagramSvg,
  problemImageUrl,
}: MathTextProps) {
  const tCommon = useTranslations("common");
  const safeSvg = useMemo(
    () => (diagramSvg ? sanitizeSvg(diagramSvg) : null),
    [diagramSvg],
  );

  // Check if text has [그림: ...] or [Diagram: ...] marker
  const diagramRegex = new RegExp(DIAGRAM.PATTERN.source);
  const diagramMatch = children.match(diagramRegex);
  const diagramDesc = diagramMatch ? diagramMatch[1] : null;

  // Strip diagram marker from text so it's only shown as SVG/placeholder
  let textToRender = diagramDesc
    ? children.replace(diagramRegex, "").trim()
    : children;

  // When a problem image is present, strip trailing choice options (①②③④⑤...)
  // from text to avoid showing them twice (once in text, once in image).
  if (problemImageUrl) {
    const choiceBlockStart = textToRender.search(/①[\s\S]*②[\s\S]*③/);
    if (choiceBlockStart >= 0) {
      textToRender = textToRender.slice(0, choiceBlockStart).trim();
    }
  }

  const rendered = useMemo(
    () => renderMathText(textToRender),
    [textToRender],
  );

  // Resolve gs:// paths to browser-accessible signed URLs
  const [resolvedImageUrl, setResolvedImageUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSignedImageUrl(problemImageUrl).then((url) => {
      if (!cancelled) setResolvedImageUrl(url);
    });
    return () => { cancelled = true; };
  }, [problemImageUrl]);

  // When problem image is set, it replaces the diagram entirely
  const showDiagram = diagramDesc && !resolvedImageUrl;

  return (
    <>
      <Tag
        className={className}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
      {resolvedImageUrl && (
        <div className="my-2 flex justify-center">
          <img
            src={resolvedImageUrl}
            alt={tCommon("problemImageAlt")}
            className="max-w-full rounded-lg border"
          />
        </div>
      )}
      {showDiagram && safeSvg && (
        <div
          className="my-2 flex justify-center"
          dangerouslySetInnerHTML={{ __html: safeSvg }}
        />
      )}
      {showDiagram && !safeSvg && diagramDesc && (
        <div
          className="my-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-sm text-slate-500"
          dangerouslySetInnerHTML={{ __html: renderMathText(diagramDesc).html }}
        />
      )}
    </>
  );
}

/**
 * Preprocess plain (non-math) text for readability.
 * Only called on portions OUTSIDE $...$ delimiters, so it never
 * interferes with LaTeX commands like \neq, \not, \nu, \nabla.
 */
function preprocessPlainText(text: string): string {
  return text
    .replace(/\\n/g, " ") // Literal backslash-n → space (safe: not inside $...$)
    .replace(/[\n\r\u2028\u2029]+/g, " ") // Actual newlines → space
    .replace(/\s{2,}/g, " ") // Collapse whitespace
    // Line break before circled numbers ①–⑤ (unless adjacent to operators/other circled)
    .replace(
      /(?<![×÷+\-=·*\u2460-\u2473\u24D0-\u24E9])([\u2460-\u2464])(?![×÷+\-=·*\u24D0-\u24E9])/g,
      "\n$1",
    )
    // Line break before Korean circled consonants ㉠–㉭
    .replace(/([\u3260-\u326D])(?![×÷+\-=·*])/g, "\n$1")
    // Line break around bracketed data blocks [표: ...], [보기: ...]
    .replace(/(\[[가-힣]+:[^\]]*\])/g, "\n$1\n")
    .trim();
}

/** Split text by math delimiters and render LaTeX parts with KaTeX. */
function renderMathText(text: string): { html: string; hasLatex: boolean } {
  // Strip scan artifacts globally (these never appear inside $...$)
  const cleaned = text.replace(/<풀이\s*과정>|<풀이>|<답\s*>|<정답\s*>/g, "");

  // Split by math delimiters FIRST — before any preprocessing.
  // This ensures preprocessing (\n stripping, line break insertion) never
  // touches LaTeX content inside $...$ blocks.
  const mathRegex = /(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g;
  const parts = cleaned.split(mathRegex);

  if (parts.length === 1) {
    // No math delimiters — full plain text preprocessing
    let plainHtml = escapeHtml(preprocessPlainText(cleaned));
    // Render [보기: ...] blocks as bordered boxes
    plainHtml = plainHtml.replace(
      /\[보기:\s*([^\]]*)\]/g,
      '<div class="my-1.5 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-center">$1</div>',
    );
    return { html: plainHtml, hasLatex: false };
  }

  const htmlParts = parts.map((part) => {
    if (part.startsWith("$$") && part.endsWith("$$")) {
      const tex = part.slice(2, -2);
      try {
        return katex.renderToString(tex, {
          ...KATEX_OPTIONS,
          displayMode: true,
        });
      } catch {
        return `<span class="text-red-500">${escapeHtml(part)}</span>`;
      }
    }

    if (part.startsWith("$") && part.endsWith("$")) {
      const tex = part.slice(1, -1);
      try {
        return katex.renderToString(tex, {
          ...KATEX_OPTIONS,
          displayMode: false,
        });
      } catch {
        return `<span class="text-red-500">${escapeHtml(part)}</span>`;
      }
    }

    // Plain text — preprocess for readability
    return escapeHtml(preprocessPlainText(part));
  });

  // Post-process the joined HTML
  let html = htmlParts.join("");

  // Insert line breaks before circled numbers even across
  // math/plain boundaries (e.g. when ① follows a $...$ block directly)
  html = html.replace(
    /(?<!<br\/>)([\u2460-\u2464])/g,
    "<br/>$1",
  );

  // Render [보기: ...] blocks as bordered boxes
  html = html.replace(
    /\[보기:\s*([^\]]*)\]/g,
    '<div class="my-1.5 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-center">$1</div>',
  );

  return { html, hasLatex: true };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br/>");
}

// ---------------------------------------------------------------------------
//  Client-side SVG sanitization (defense-in-depth, backend already sanitizes)
// ---------------------------------------------------------------------------

const FORBIDDEN_SVG_ELEMENTS = new Set([
  "script", "style", "foreignobject", "iframe", "object",
  "embed", "applet", "form", "input", "button",
]);

function sanitizeSvg(raw: string): string | null {
  if (!raw || raw.length > DIAGRAM.MAX_SIZE_CHARS) return null;

  if (typeof window === "undefined") return null;

  try {
    // Parse as text/html (more lenient than image/svg+xml for missing xmlns)
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, "text/html");
    const svg = doc.querySelector("svg");
    if (!svg) return null;

    sanitizeElement(svg);

    // Ensure responsive sizing
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.maxWidth = "100%";
    svg.style.height = "auto";

    return svg.outerHTML;
  } catch {
    return null;
  }
}

function sanitizeElement(el: Element): void {
  const tag = el.tagName.toLowerCase();

  if (FORBIDDEN_SVG_ELEMENTS.has(tag)) {
    el.remove();
    return;
  }

  // Remove dangerous attributes
  const toRemove: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) {
      toRemove.push(attr.name);
    }
    if ((name === "href" || name === "xlink:href") && attr.value) {
      const val = attr.value.trim().toLowerCase();
      if (val.startsWith("javascript:") || val.startsWith("data:")) {
        toRemove.push(attr.name);
      }
    }
  }
  for (const name of toRemove) {
    el.removeAttribute(name);
  }

  // Recurse children
  for (const child of Array.from(el.children)) {
    if (FORBIDDEN_SVG_ELEMENTS.has(child.tagName.toLowerCase())) {
      child.remove();
    } else {
      sanitizeElement(child);
    }
  }
}
