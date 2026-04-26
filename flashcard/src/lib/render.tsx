// Rendu sécurisé : markdown léger + LaTeX (KaTeX)
import katex from "katex";
import { useMemo } from "react";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

  let s = src;

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
