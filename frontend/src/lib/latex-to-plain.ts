/**
 * Convert LaTeX-wrapped text to plain editable text (client-side, no API call).
 * Strips $...$ delimiters and converts common LaTeX commands to Unicode/plain.
 */
export function latexToPlainLocal(text: string): string {
  let t = text;
  // Remove display math delimiters ($$...$$), then inline ($...$)
  t = t.replace(/\$\$([\s\S]+?)\$\$/g, "$1");
  t = t.replace(/\$([^$]+?)\$/g, "$1");
  // Mixed numbers: 3\frac{1}{5} → 3 1/5
  t = t.replace(/(\d+)\s*\\frac\{([^}]+)\}\{([^}]+)\}/g, "$1 $2/$3");
  // Fractions: \frac{a}{b} → a/b
  t = t.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "$1/$2");
  // Square root: \sqrt{x} → √x
  t = t.replace(/\\sqrt\{([^}]+)\}/g, "√$1");
  // Exponents
  t = t.replace(/\^{2}/g, "²");
  t = t.replace(/\^{3}/g, "³");
  t = t.replace(/\^{([^}]+)}/g, "^$1");
  t = t.replace(/\^2/g, "²");
  t = t.replace(/\^3/g, "³");
  // Subscripts: a_{n} → a_n
  t = t.replace(/_\{([^}]+)\}/g, "_$1");
  // Operators
  t = t.replace(/\\times/g, "×");
  t = t.replace(/\\div/g, "÷");
  t = t.replace(/\\cdot/g, "·");
  t = t.replace(/\\pm/g, "±");
  t = t.replace(/\\implies/g, "⇒");
  // Comparison
  t = t.replace(/\\leq/g, "≤");
  t = t.replace(/\\geq/g, "≥");
  t = t.replace(/\\neq/g, "≠");
  t = t.replace(/\\le\b/g, "≤");
  t = t.replace(/\\ge\b/g, "≥");
  // Greek
  t = t.replace(/\\pi/g, "π");
  t = t.replace(/\\alpha/g, "α");
  t = t.replace(/\\beta/g, "β");
  t = t.replace(/\\theta/g, "θ");
  // Special
  t = t.replace(/\\infty/g, "∞");
  t = t.replace(/\\square/g, "□");
  t = t.replace(/\\to/g, "→");
  t = t.replace(/\\rightarrow/g, "→");
  // Functions (remove backslash)
  for (const fn of ["log", "ln", "sin", "cos", "tan", "lim"]) {
    t = t.replaceAll(`\\${fn}`, fn);
  }
  // Parentheses
  t = t.replace(/\\left\s*([(\[{|])/g, "$1");
  t = t.replace(/\\right\s*([)\]}|])/g, "$1");
  // \text{...} → contents
  t = t.replace(/\\text\{([^}]*)\}/g, "$1");
  // Remove spacing commands
  t = t.replace(/\\(?:,|;|quad|qquad|!)\s*/g, " ");
  // Remove remaining backslash commands
  t = t.replace(/\\[a-zA-Z]+/g, "");
  // Clean up braces and whitespace
  t = t.replace(/[{}]/g, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}
