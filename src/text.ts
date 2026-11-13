const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function displayWidth(text: string): number {
  return Bun.stringWidth(text)
}

export function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  if (displayWidth(text) <= maxWidth) return text
  let truncated = ""
  let usedWidth = 0
  for (const { segment } of graphemeSegmenter.segment(text)) {
    const segmentWidth = displayWidth(segment)
    if (usedWidth + segmentWidth > maxWidth - 1) break
    truncated += segment
    usedWidth += segmentWidth
  }
  return truncated + "…"
}

export function fitToWidth(text: string, width: number): string {
  const truncated = truncateToWidth(text, width)
  return truncated + " ".repeat(Math.max(0, width - displayWidth(truncated)))
}

function wrapParagraph(paragraph: string, width: number): string[] {
  const lines: string[] = []
  let currentLine = ""
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    const candidate = currentLine ? `${currentLine} ${word}` : word
    if (displayWidth(candidate) <= width) {
      currentLine = candidate
      continue
    }
    if (currentLine) lines.push(currentLine)
    currentLine = truncateToWidth(word, width)
  }
  lines.push(currentLine)
  return lines
}

export function wrapToWidth(text: string, width: number): string[] {
  return text.split(/\r?\n/).flatMap((paragraph) => wrapParagraph(paragraph, width))
}

// Todoist content is Markdown and may hold line breaks or escape codes.
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
}

function paired(startCode: number, endCode: number) {
  return (text: string) => `\x1b[${startCode}m${text}\x1b[${endCode}m`
}

// Each style ends with its own off code, so styles nest without a full reset.
export const style = {
  bold: paired(1, 22),
  dim: paired(2, 22),
  reverse: paired(7, 27),
  red: paired(31, 39),
  green: paired(32, 39),
  yellow: paired(33, 39),
  magenta: paired(35, 39),
  cyan: paired(36, 39),
  blueBackground: paired(44, 49),
}
