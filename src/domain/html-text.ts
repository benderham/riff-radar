/**
 * HTML reduced to roughly clean text.
 *
 * A hand-written stripper rather than a parser dependency (ADR-0013): the model
 * performs extraction, so the text only has to be legible, not structurally
 * faithful. What matters is that a listing's rows stay on separate lines and
 * that nothing invisible on the page — scripts, styles, comments — reaches the
 * model as if it were content.
 */

/** Elements whose content is never page text. Dropped whole, not untagged. */
const INVISIBLE = /<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

/**
 * Elements that end a line. Anything else is inline and keeps its neighbours —
 * `td` and `th` deliberately among them, so a calendar row stays one line of
 * date, artist and title rather than three orphaned fragments.
 */
const BLOCK =
  /<\/?(address|article|aside|blockquote|br|div|dd|dl|dt|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|tfoot|thead|tr|ul)\b[^>]*>/gi

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}

// ponytail: the named entities a metal release listing actually contains.
// Anything else is left as typed — an undecoded `&eacute;` is legible to the
// model, and a full entity table would be more code than the problem.
const decodeEntities = (text: string): string =>
  text.replaceAll(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x') || body.startsWith('#X')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })

export const htmlToText = (html: string): string =>
  decodeEntities(
    html
      .replaceAll(/<!--[\s\S]*?-->/g, '')
      .replaceAll(INVISIBLE, ' ')
      .replaceAll(BLOCK, '\n')
      // Every remaining tag is inline, including an unclosed one at the very end
      // of a truncated page, which must not swallow the text before it.
      .replaceAll(/<[^>]*>/g, ' ')
      .replaceAll(/<[^>]*$/g, ' '),
  )
    .replaceAll(/[^\S\n]+/g, ' ')
    .replaceAll(/ ?\n ?/g, '\n')
    .replaceAll(/\n{2,}/g, '\n')
    .trim()
