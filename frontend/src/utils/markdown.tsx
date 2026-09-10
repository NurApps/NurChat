import DOMPurify from "dompurify"

const ALLOWED_TAGS = ["strong", "em", "code", "a"]
const ALLOWED_ATTR = ["href", "target", "rel", "class"]

export function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n")
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

    // 1. Escape HTML entities first (prevents XSS)
    const escaped = line
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")

    // 2. Apply markdown formatting (on escaped text)
    let html = escaped
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code class='msg-inline-code'>$1</code>")
      .replace(
        /(https?:\/\/[^\s&lt;&gt;"'()]+|[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s&lt;&gt;"'()]*)?)/gi,
        (m) => {
          const href = m.startsWith("http") ? m : `https://${m}`
          // Only allow http/https hrefs (blocks javascript:)
          if (!href.startsWith("http")) return m
          const safeHref = href.replace(/&amp;/g, "&")
          return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="msg-link">${m}</a>`
        }
      )

    // 3. Sanitize AFTER regex (defense in depth)
    html = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })

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
