/**
 * Client-side thumbnail generation for images
 */

const THUMB_SIZES = {
  small: 80,
  medium: 200,
  large: 400,
}

type ThumbSize = keyof typeof THUMB_SIZES

/**
 * Generate thumbnail from image URL
 */
export async function generateThumbnail(
  imageUrl: string,
  size: ThumbSize = "small",
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const maxSize = THUMB_SIZES[size]
      let { width, height } = img

      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width
          width = maxSize
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height
          height = maxSize
        }
      }

      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve(imageUrl)
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL("image/jpeg", 0.7))
    }
    img.onerror = () => resolve(imageUrl)
    img.src = imageUrl
  })
}

/**
 * Generate thumbnail from File object
 */
export async function generateThumbnailFromFile(
  file: File,
  size: ThumbSize = "small",
): Promise<string> {
  if (!file.type.startsWith("image/")) return ""
  const url = URL.createObjectURL(file)
  try {
    const thumb = await generateThumbnail(url, size)
    return thumb
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Create thumbnail cache in localStorage
 */
const THUMB_CACHE_KEY = "thumbnail_cache"
const THUMB_CACHE_MAX = 200

export function getCachedThumbnail(url: string): string | null {
  try {
    const cache = JSON.parse(localStorage.getItem(THUMB_CACHE_KEY) || "{}")
    return cache[url] || null
  } catch {
    return null
  }
}

export function setCachedThumbnail(url: string, thumb: string) {
  try {
    const cache = JSON.parse(localStorage.getItem(THUMB_CACHE_KEY) || "{}")
    const keys = Object.keys(cache)
    if (keys.length > THUMB_CACHE_MAX) {
      // Remove oldest entries
      const toRemove = keys.slice(0, keys.length - THUMB_CACHE_MAX)
      toRemove.forEach((k) => delete cache[k])
    }
    cache[url] = thumb
    localStorage.setItem(THUMB_CACHE_KEY, JSON.stringify(cache))
  } catch {}
}
