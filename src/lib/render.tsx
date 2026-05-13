// Rendu sécurisé : markdown léger + LaTeX (KaTeX)
import katex from "katex";
import { useMemo } from "react";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeImportedHtml(s: string, ph: (html: string) => string): string {
  let out = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<\/div\s*>/gi, "\n")
    .replace(/<p\b[^>]*>/gi, "")
    .replace(/<div\b[^>]*>/gi, "");

  // Autorise uniquement les spans de couleur importés depuis Anki/HTML.
  out = out.replace(/<span\s+[^>]*style=["'][^"']*color\s*:\s*([^;"']+)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_, color, inner) => {
      const safeColor = String(color).trim().match(/^(#[0-9a-f]{3,8}|rgb\([0-9,\s.]+\)|rgba\([0-9,\s.]+\)|[a-z]+)$/i)?.[0] || "inherit";
      return ph(`<span style="color:${safeColor}">${escapeHtml(String(inner).replace(/<[^>]+>/g, ""))}</span>`);
    }
  );

  // Supprime les autres balises HTML courantes au lieu de les afficher en texte,
  // sans toucher aux inégalités mathématiques de type x < y.
  out = out.replace(/<\/?(span|font|b|i|u|strong|em|body|html|center|section|article|small|big)[^>]*>/gi, "");
  return out;
}

function renderMath(expr: string, display: boolean): string {
  try {
    return katex.renderToString(expr, {
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
      output: "html",
    });
  } catch {
    return escapeHtml(expr);
  }
}

// Convertit le texte en HTML : gère $$..$$, $..$, \(..\), \[..\], images, [latex], [$], markdown léger.
export function renderToHtml(src: string, images: Record<string, string> = {}): string {
  if (!src) return "";

  // 1. Extraction des blocs math (placeholders) pour ne pas qu'ils soient touchés par md
  const placeholders: string[] = [];
  const ph = (html: string) => {
    placeholders.push(html);
    return `\u0000PH${placeholders.length - 1}\u0000`;
  };

  let s = normalizeImportedHtml(src, ph);

  // Environnements LaTeX listés : \begin{itemize} ou \\begin{itemize} (double backslash parfois présent)
  // On les convertit en liste markdown. On gère aussi \item isolés hors bloc \begin.
  s = s.replace(/\\{1,2}begin\{(itemize|enumerate)\s*\}([\s\S]*?)\\{1,2}end\{[^}]+\}/gi,
    (_, _type, inner) => {
      const items = String(inner)
        .split(/\\{1,2}item\s*/)
        .map(x => x.trim())
        .filter(Boolean);
      return items.map(x => `- ${x}`).join("\n");
    }
  );
  // \item orphelins (sans \begin/\end autour)
  s = s.replace(/(^|\n)\s*\\{1,2}item\s+/g, "$1- ");

  // Images : ![label](image:nom.png), [image:nom.png], ou >>> [IMAGE_ID: nom.png] <<<
  const imageHtml = (id: string, alt = "image") => {
    const safeId = id.trim();
    const url = images[safeId];
    if (!url) return `<span class="text-muted">[image manquante: ${escapeHtml(safeId)}]</span>`;
    return `<figure class="fc-img-wrap"><img src="${url}" alt="${escapeHtml(alt)}" class="fc-img" loading="lazy" /><figcaption class="text-[11px] text-muted text-center mt-1">${escapeHtml(safeId)}</figcaption></figure>`;
  };
  s = s.replace(/!\[([^\]]*)\]\(image:([^\)]+)\)/g, (_, alt, id) => ph(imageHtml(id, alt || id)));
  s = s.replace(/\[image:([^\]]+)\]/g, (_, id) => ph(imageHtml(id, id)));
  s = s.replace(/>>>\s*\[IMAGE_ID:\s*([^\]]+)\]\s*<<</g, (_, id) => ph(imageHtml(id, id)));

  // [latex]$...$[/latex] ou [latex]...[/latex]
  s = s.replace(/\[latex\]\$?([\s\S]*?)\$?\[\/latex\]/g, (_, m) => ph(renderMath(m, false)));
  // [$]...[/$]
  s = s.replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, (_, m) => ph(renderMath(m, false)));
  // $$...$$
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => ph(renderMath(m, true)));
  // \[...\]
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => ph(renderMath(m, true)));
  // \(...\)
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => ph(renderMath(m, false)));
  // $...$ inline (non greedy, pas de saut de ligne entre)
  s = s.replace(/\$([^\$\n]+?)\$/g, (_, m) => ph(renderMath(m, false)));

  // 2. Échapper le HTML
  s = escapeHtml(s);

  // 3. Markdown léger
  // Gras
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  // Italique (éviter de matcher dans le gras déjà transformé)
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  // Code inline
  s = s.replace(/`([^`\n]+?)`/g, "<code>$1</code>");

  // Listes simples : transforme lignes commençant par "- " en <li>
  const lines = s.split("\n");
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^\s*[-•]\s+(.*)$/);
    if (m) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push("<li>" + m[1] + "</li>");
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(line);
    }
  }
  if (inList) out.push("</ul>");
  s = out.join("\n");

  // Paragraphes / retours ligne
  s = s
    .split(/\n{2,}/)
    .map(b => b.trim() ? `<p>${b.replace(/\n/g, "<br>")}</p>` : "")
    .join("");

  // 4. Réinjecter les placeholders math
  s = s.replace(/\u0000PH(\d+)\u0000/g, (_, i) => placeholders[Number(i)]);

  return s;
}

export function RichText({ text, images, className, style }: { text: string; images?: Record<string, string>; className?: string; style?: React.CSSProperties }) {
  const html = useMemo(() => renderToHtml(text, images), [text, images]);
  return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}
