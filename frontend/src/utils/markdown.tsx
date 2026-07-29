import DOMPurify from "dompurify"

export function renderMarkdown(text: string): React.ReactNode {
  const safe = DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
  const lines = safe.split("\n")
  const elements: React.ReactNode[] = []
  let inCode = false
  let codeBuffer: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith("```")) {
      if (inCode) {
        elements.push(<pre key={`code-${i}`} className="msg-code-block"><code>{codeBuffer.join("\n")}</code></pre>)
        codeBuffer = []
      }
      inCode = !inCode
      continue
    }

    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    const html = line
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code class='msg-inline-code'>$1</code>")
      .replace(
        /(https?:\/\/[^\s<>"'()]+|[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s<>"'()]*)?)/gi,
        (m) => {
          const href = m.startsWith("http") ? m : `https://${m}`
          return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="msg-link">${m}</a>`
        }
      )

    elements.push(
      <span key={`line-${i}`}>
        {i > 0 && <br />}
        <span dangerouslySetInnerHTML={{ __html: html }} />
      </span>
    )
  }

  if (inCode && codeBuffer.length > 0) {
    elements.push(<pre key="code-trailing" className="msg-code-block"><code>{codeBuffer.join("\n")}</code></pre>)
  }

  return <>{elements}</>
}
