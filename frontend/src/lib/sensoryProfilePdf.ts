import { jsPDF } from 'jspdf'

export type SensoryProfilePdfFoodItem = {
  name: string
  status: 'SAFE' | 'UNSAFE' | 'SOMETIMES' | 'UNSURE'
}

export type SensoryProfilePdfPayload = {
  userId: string | null
  generatedAtLabel: string
  unsafeTextures: string[]
  dietaryNeeds: string[]
  culturalRequirements: string[]
  foodItems: SensoryProfilePdfFoodItem[]
}

function safeFilenamePart(v: string): string {
  return v
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80)
}

function statusLabel(status: SensoryProfilePdfFoodItem['status']): string {
  if (status === 'SAFE') return 'SAFE'
  if (status === 'UNSAFE') return 'UNSAFE'
  if (status === 'UNSURE') return 'SOMETIMES'
  return 'SOMETIMES'
}

async function loadImageAsDataUrl(src: string): Promise<string> {
  const res = await fetch(src)
  if (!res.ok) throw new Error(`Failed to load image: ${src}`)
  const blob = await res.blob()

  const imgUrl = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not decode image'))
      el.src = imgUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(imgUrl)
  }
}

export async function downloadSensoryProfilePdf(payload: SensoryProfilePdfPayload): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 48
  const contentW = pageW - margin * 2

  const footerText = 'Created by BiteBud'

  function drawFooter() {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(110)
    doc.text(footerText, margin, pageH - margin + 18)
    doc.setTextColor(0)
  }

  function addPageWithFooter() {
    doc.addPage()
    drawFooter()
  }

  let y = margin

  // Footer for first page.
  drawFooter()

  // Header (logo + title)
  let logoDataUrl: string | null = null
  try {
    logoDataUrl = await loadImageAsDataUrl('/bitebud-mark.png')
  } catch {
    logoDataUrl = null
  }

  const logoSize = 34
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', margin, y - 4, logoSize, logoSize)
  }

  const title = payload.userId?.trim() ? `Sensory profile — ${payload.userId.trim()}` : 'Sensory profile'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  const titleX = logoDataUrl ? margin + logoSize + 10 : margin
  doc.text(title, titleX, y + 18)

  y += 34

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(90)
  doc.text(payload.generatedAtLabel, titleX, y + 2)
  doc.setTextColor(0)
  y += 18

  y += 10

  const lineH = 14
  const sectionGap = 12

  function ensureSpace(nextHeight: number) {
    if (y + nextHeight <= pageH - margin) return
    addPageWithFooter()
    y = margin
  }

  function drawSectionHeader(text: string) {
    ensureSpace(26)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(text, margin, y)
    y += 18
  }

  function drawBullets(lines: string[]) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)

    const cleaned = (lines ?? []).map((x) => (x ?? '').trim()).filter(Boolean)
    if (!cleaned.length) {
      ensureSpace(18)
      doc.setTextColor(90)
      doc.text('None selected.', margin, y)
      doc.setTextColor(0)
      y += 18
      return
    }

    for (const raw of cleaned) {
      const bullet = '• '
      const wrapped = doc.splitTextToSize(`${bullet}${raw}`, contentW) as string[]
      ensureSpace(wrapped.length * lineH + 2)
      for (const w of wrapped) {
        doc.text(w, margin, y)
        y += lineH
      }
    }
    y += 6
  }

  drawSectionHeader('Sensory challenging textures (unsafe)')
  drawBullets(payload.unsafeTextures)
  y += sectionGap

  drawSectionHeader('Dietary needs')
  drawBullets(payload.dietaryNeeds)
  y += sectionGap

  drawSectionHeader('Cultural requirements')
  drawBullets(payload.culturalRequirements)
  y += sectionGap

  drawSectionHeader('Food safety tags')
  if (!payload.foodItems?.length) {
    drawBullets([])
  } else {
    const items = payload.foodItems
      .map((it) => {
        const name = (it.name ?? '').trim()
        if (!name) return null
        return `${name} — ${statusLabel(it.status)}`
      })
      .filter((x): x is string => Boolean(x))
    drawBullets(items)
  }

  const filename = payload.userId?.trim()
    ? `sensory-profile-${safeFilenamePart(payload.userId)}.pdf`
    : 'sensory-profile.pdf'
  doc.save(filename)
}

