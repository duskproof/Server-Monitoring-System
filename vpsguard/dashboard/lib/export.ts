import { downloadBlob } from '@/lib/utils';

/**
 * Serialises the first `<svg>` inside `container` and downloads it as a PNG.
 * Recharts renders plain SVG, so a canvas round-trip is enough — no extra deps.
 */
export async function exportSvgAsPng(
  container: HTMLElement | null,
  filename: string,
  backgroundColor = '#0b1220',
  scale = 2,
): Promise<void> {
  if (!container) throw new Error('Nothing to export yet');

  const svg = container.querySelector('svg');
  if (!svg) throw new Error('Chart is not rendered yet');

  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const serialized = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser');

    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to encode the PNG image');

    downloadBlob(blob, filename.endsWith('.png') ? filename : `${filename}.png`);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to rasterise the chart'));
    image.src = src;
  });
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Downloads an array of records as a UTF-8 CSV file (Excel-friendly BOM). */
export function exportRowsAsCsv(
  rows: Array<Record<string, unknown>>,
  filename: string,
  columns?: string[],
): void {
  const headers = columns ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(',')),
  ];

  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}
