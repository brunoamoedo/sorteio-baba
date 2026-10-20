function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Dimensão de exportação, fixa e de alta resolução.
 *
 * Antes o tamanho vinha de `getBoundingClientRect()` — ou seja, do quanto o
 * campo ocupava **na tela naquele momento**. No celular, com o campo em 240px,
 * o PNG saía em 240×336: uma imagem pequena e serrilhada para mandar no grupo,
 * justo onde ela é mais usada. A proporção acompanha o viewBox do campo
 * (120×170).
 */
const EXPORT_WIDTH = 1080;
const EXPORT_HEIGHT = 1530;

/** Proporção real do SVG, para a exportação nunca distorcer o desenho. */
function exportSize(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.viewBox?.baseVal;
  if (!viewBox || !viewBox.width || !viewBox.height) {
    return { width: EXPORT_WIDTH, height: EXPORT_HEIGHT };
  }
  return {
    width: EXPORT_WIDTH,
    height: Math.round((EXPORT_WIDTH * viewBox.height) / viewBox.width),
  };
}

function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const { width, height } = exportSize(svg);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  return new XMLSerializer().serializeToString(clone);
}

export function exportSvgFile(svg: SVGSVGElement, filename: string) {
  const source = serializeSvg(svg);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(blob, filename);
}

export async function exportPngFile(svg: SVGSVGElement, filename: string): Promise<void> {
  const source = serializeSvg(svg);
  const { width, height } = exportSize(svg);

  const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, width, height);

    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (pngBlob) {
      triggerDownload(pngBlob, filename);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

/** Baixa a imagem única com todos os times. */
export function downloadImage(blob: Blob, filename: string) {
  triggerDownload(blob, filename);
}

/** Compartilhamento nativo: o texto e **uma** imagem com todos os times.
 *
 * Antes iam N anexos, um campo por time — o grupo recebia uma sequência de
 * imagens e ninguém via a escalação inteira de uma vez. */
export async function shareResult(text: string, image: Blob | null): Promise<"shared" | "fallback"> {
  if (navigator.share) {
    try {
      const files = image ? [new File([image], "sorteio-times.png", { type: "image/png" })] : [];

      if (files.length > 0 && navigator.canShare?.({ files })) {
        await navigator.share({ text, files });
      } else {
        await navigator.share({ text });
      }
      return "shared";
    } catch {
      // usuário cancelou ou o navegador recusou — cai no fallback abaixo
    }
  }

  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  return "fallback";
}
