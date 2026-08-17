/**
 * A markdown renderer covering exactly the subset docs/ARCHITECTURE.md uses:
 * frontmatter, headings, paragraphs, bullet lists, fenced code, pipe tables,
 * and inline code, emphasis, and links. It exists instead of a dependency
 * because the input is one file this repo writes, and a general parser would
 * bring a client bundle and a sanitiser question for no gain here.
 *
 * Everything is escaped before any tag is emitted, so the document cannot
 * inject markup even if someone pastes HTML into it.
 */

export interface DocHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface RenderedDoc {
  title: string;
  updated: string;
  status: string;
  headings: DocHeading[];
  html: string;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Long enough that it cannot occur in the document's own prose. */
const CODE_MARK = '@@fplcode';

/**
 * Inline markup, applied to already escaped text. Code spans are extracted
 * first and restored last, so a backticked asterisk pair is not read as
 * emphasis.
 */
function inline(escaped: string): string {
  const codeSpans: string[] = [];
  let text = escaped.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push(code);
    return `${CODE_MARK}${String(codeSpans.length - 1)}${CODE_MARK}`;
  });

  // A link to another file in the repo cannot resolve in the browser, so the
  // path is kept as visible provenance rather than rendered as a dead link.
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) =>
    href.startsWith('http')
      ? `<a href="${href}" rel="noreferrer">${label}</a>`
      : `${label} <span class="docPath">${href}</span>`,
  );

  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  const restore = new RegExp(`${CODE_MARK}(\\d+)${CODE_MARK}`, 'g');
  return text.replace(restore, (_match, index: string) => {
    const code = codeSpans[Number(index)] ?? '';
    return `<code>${code}</code>`;
  });
}

const cell = (raw: string): string => inline(escapeHtml(raw.trim()));

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((part) => part.trim());
}

const isTableDivider = (line: string): boolean => /^\|[\s|:-]+\|?$/.test(line.trim());

interface Frontmatter {
  title: string;
  updated: string;
  status: string;
}

function readFrontmatter(lines: string[]): { frontmatter: Frontmatter; body: string[] } {
  const fields = new Map<string, string>();
  let body = lines;

  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const separator = line.indexOf(':');
        if (separator === -1) continue;
        fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
      }
      body = lines.slice(end + 1);
    }
  }

  return {
    frontmatter: {
      title: fields.get('title') ?? 'Untitled',
      updated: fields.get('updated') ?? '',
      status: fields.get('status') ?? '',
    },
    body,
  };
}

export function renderDoc(source: string): RenderedDoc {
  const { frontmatter, body } = readFrontmatter(source.replace(/\r\n/g, '\n').split('\n'));
  const headings: DocHeading[] = [];
  const out: string[] = [];

  let index = 0;
  while (index < body.length) {
    const line = body[index] ?? '';

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    // Fenced code. The fence's language tag is ignored: nothing in this
    // document is highlighted, and the blocks are shell and directory trees.
    if (line.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < body.length && !(body[index] ?? '').startsWith('```')) {
        code.push(body[index] ?? '');
        index += 1;
      }
      index += 1;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(##|###)\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1] === '##' ? 2 : 3;
      const text = heading[2] ?? '';
      const id = slugify(text);
      headings.push({ id, text, level });
      out.push(`<h${String(level)} id="${id}">${inline(escapeHtml(text))}</h${String(level)}>`);
      index += 1;
      continue;
    }

    if (line.trim().startsWith('|') && isTableDivider(body[index + 1] ?? '')) {
      const header = splitRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < body.length && (body[index] ?? '').trim().startsWith('|')) {
        rows.push(splitRow(body[index] ?? ''));
        index += 1;
      }
      const head = header.map((column) => `<th scope="col">${cell(column)}</th>`).join('');
      const cells = rows
        .map((row) => `<tr>${row.map((column) => `<td>${cell(column)}</td>`).join('')}</tr>`)
        .join('');
      out.push(
        `<div class="docTableScroll"><table><thead><tr>${head}</tr></thead><tbody>${cells}</tbody></table></div>`,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (index < body.length && /^[-*]\s+/.test((body[index] ?? '').trim())) {
        const item = (body[index] ?? '').trim().replace(/^[-*]\s+/, '');
        const continuation: string[] = [item];
        index += 1;
        // A wrapped bullet continues on an indented line rather than starting a
        // paragraph of its own.
        while (index < body.length && /^\s{2,}\S/.test(body[index] ?? '')) {
          continuation.push((body[index] ?? '').trim());
          index += 1;
        }
        items.push(`<li>${inline(escapeHtml(continuation.join(' ')))}</li>`);
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    const paragraph: string[] = [];
    while (index < body.length) {
      const current = body[index] ?? '';
      if (
        current.trim() === '' ||
        current.startsWith('```') ||
        /^(##|###)\s/.test(current) ||
        current.trim().startsWith('|') ||
        /^[-*]\s+/.test(current.trim())
      ) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    out.push(`<p>${inline(escapeHtml(paragraph.join(' ')))}</p>`);
  }

  return { ...frontmatter, headings, html: out.join('\n') };
}
