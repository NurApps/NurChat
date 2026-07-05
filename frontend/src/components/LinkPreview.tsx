import { useState, useEffect, memo } from "react"

interface LinkPreviewData {
  title: string
  description: string
  image: string | null
  url: string
}

const cache = new Map<string, LinkPreviewData | null>()

function extractMeta(html: string, url: string): LinkPreviewData {
  const get = (name: string) => {
    const re = new RegExp(`<meta[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i")
    const m = html.match(re)
    return m ? m[1] : ""
  }
  return {
    title: get("og:title") || get("twitter:title") || document.title || url,
    description: get("og:description") || get("twitter:description") || get("description") || "",
    image: get("og:image") || get("twitter:image") || null,
    url,
  }
}

async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  if (cache.has(url)) return cache.get(url)!
  try {
    const res = await fetch(url, { mode: "no-cors" })
    const text = await res.text()
    const data = extractMeta(text, url)
    cache.set(url, data)
    return data
  } catch {
    cache.set(url, null)
    return null
  }
}

interface Props {
  url: string
}

const LinkPreview = memo(function LinkPreview({ url }: Props) {
  const [data, setData] = useState<LinkPreviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchLinkPreview(url).then((d) => {
      if (!cancelled) { setData(d); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [url])

  if (loading) return <div className="link-preview loading"><div className="link-preview-shimmer" /></div>
  if (!data) return null

  return (
    <a className="link-preview" href={url} target="_blank" rel="noopener noreferrer">
      {data.image && <img className="link-preview-img" src={data.image} alt="" />}
      <div className="link-preview-body">
        <span className="link-preview-title">{data.title}</span>
        {data.description && <span className="link-preview-desc">{data.description.slice(0, 120)}</span>}
        <span className="link-preview-url">{new URL(url).hostname}</span>
      </div>
    </a>
  )
})

export default LinkPreview
