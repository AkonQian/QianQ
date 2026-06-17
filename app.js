const state = {
  fileName: "",
  sourceDataUrl: "",
  sourceWidth: 0,
  sourceHeight: 0,
  svg: "",
  mode: "mono",
};

const ICON_SIZES = [16, 32, 48, 64, 128, 256];

const els = {
  dropZone: document.querySelector("[data-drop-zone]"),
  fileInput: document.querySelector("[data-file-input]"),
  chooseButtons: document.querySelectorAll("[data-choose-file]"),
  sampleButtons: document.querySelectorAll("[data-sample]"),
  detail: document.querySelector("[data-detail]"),
  threshold: document.querySelector("[data-threshold]"),
  noise: document.querySelector("[data-noise]"),
  detailValue: document.querySelector("[data-detail-value]"),
  thresholdValue: document.querySelector("[data-threshold-value]"),
  noiseValue: document.querySelector("[data-noise-value]"),
  modeInputs: document.querySelectorAll("input[name='mode']"),
  originalPreview: document.querySelector("[data-original-preview]"),
  svgPreview: document.querySelector("[data-svg-preview]"),
  svgCode: document.querySelector("[data-svg-code]"),
  download: document.querySelector("[data-download]"),
  downloadIcon: document.querySelector("[data-download-icon]"),
  copy: document.querySelector("[data-copy]"),
  reset: document.querySelector("[data-reset]"),
  stats: document.querySelector("[data-stats]"),
  iconSizes: document.querySelector("[data-icon-sizes]"),
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateRangeLabels() {
  if (els.detailValue) els.detailValue.textContent = `${els.detail.value}px`;
  if (els.thresholdValue) els.thresholdValue.textContent = `${els.threshold.value}`;
  if (els.noiseValue) els.noiseValue.textContent = `${els.noise.value}px`;
}

function setEmptyPreview() {
  if (els.originalPreview) {
    els.originalPreview.innerHTML = `<span class="empty-preview">PNG preview</span>`;
  }
  if (els.svgPreview) {
    els.svgPreview.innerHTML = `<span class="empty-preview">SVG preview</span>`;
  }
  if (els.svgCode) {
    els.svgCode.textContent = "<svg><!-- upload a PNG to generate output --></svg>";
  }
  if (els.stats) {
    els.stats.innerHTML = `
      <div class="stat"><span>Input</span><strong>-</strong></div>
      <div class="stat"><span>Output</span><strong>-</strong></div>
      <div class="stat"><span>Nodes</span><strong>-</strong></div>
    `;
  }
  if (els.iconSizes) {
    els.iconSizes.innerHTML = ICON_SIZES.map((size) => `<div class="icon-size">${size}</div>`).join("");
  }
  if (els.download) els.download.disabled = true;
  if (els.downloadIcon) els.downloadIcon.disabled = true;
  if (els.copy) els.copy.disabled = true;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function rgbaToHex(r, g, b) {
  const toHex = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function quantizeChannel(value) {
  return Math.round(value / 32) * 32;
}

function getCanvasData(img, maxSize) {
  const ratio = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * ratio));
  const height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, width, height);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

function drawContainedImage(ctx, img, size) {
  const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const x = Math.round((size - width) / 2);
  const y = Math.round((size - height) / 2);
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x, y, width, height);
}

function renderIconPreview(img) {
  if (!els.iconSizes) return;
  els.iconSizes.innerHTML = "";
  ICON_SIZES.forEach((size) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    drawContainedImage(canvas.getContext("2d"), img, size);
    const item = document.createElement("div");
    item.className = "icon-size";
    item.innerHTML = `<img alt="${size} by ${size} icon preview" src="${canvas.toDataURL("image/png")}"><span>${size}</span>`;
    els.iconSizes.appendChild(item);
  });
}

function buildRectPath(x, y, w, h) {
  return `M${x} ${y}h${w}v${h}h-${w}z`;
}

function traceToSvg(img, mode, settings) {
  const maxSize = Number(settings.detail);
  const threshold = Number(settings.threshold);
  const minRun = Number(settings.noise);
  const { width, height, data } = getCanvasData(img, maxSize);
  const scaleX = img.naturalWidth / width;
  const scaleY = img.naturalHeight / height;
  const paths = new Map();
  let nodeCount = 0;

  for (let y = 0; y < height; y += 1) {
    let runColor = null;
    let runStart = 0;
    let runLength = 0;

    function flushRun(endX) {
      if (!runColor || runLength < minRun) return;
      const x = Math.round(runStart * scaleX * 100) / 100;
      const yy = Math.round(y * scaleY * 100) / 100;
      const w = Math.max(0.5, Math.round((endX - runStart) * scaleX * 100) / 100);
      const h = Math.max(0.5, Math.round(scaleY * 100) / 100);
      const d = buildRectPath(x, yy, w, h);
      paths.set(runColor, `${paths.get(runColor) || ""}${d}`);
      nodeCount += 1;
    }

    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let color = null;

      if (mode === "color") {
        if (a >= threshold) {
          color = rgbaToHex(quantizeChannel(r), quantizeChannel(g), quantizeChannel(b));
        }
      } else if (a >= threshold && luma < threshold) {
        color = "#111827";
      }

      if (color === runColor) {
        runLength += 1;
      } else {
        flushRun(x);
        runColor = color;
        runStart = x;
        runLength = color ? 1 : 0;
      }
    }
    flushRun(width);
  }

  const pathMarkup = [...paths.entries()]
    .map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`)
    .join("\n  ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${img.naturalWidth}" height="${img.naturalHeight}" viewBox="0 0 ${img.naturalWidth} ${img.naturalHeight}" role="img" aria-label="${escapeXml(state.fileName || "Converted PNG")}">\n  ${pathMarkup || `<rect width="100%" height="100%" fill="none"/>`}\n</svg>`;

  return { svg, nodeCount, sampled: `${width}x${height}` };
}

function embedToSvg(img) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${img.naturalWidth}" height="${img.naturalHeight}" viewBox="0 0 ${img.naturalWidth} ${img.naturalHeight}" role="img" aria-label="${escapeXml(state.fileName || "Embedded PNG")}">\n  <image width="${img.naturalWidth}" height="${img.naturalHeight}" href="${state.sourceDataUrl}"/>\n</svg>`;
  return { svg, nodeCount: 1, sampled: "exact image" };
}

async function renderConversion() {
  if (!state.sourceDataUrl) return;
  updateRangeLabels();

  const img = await loadImage(state.sourceDataUrl);
  state.sourceWidth = img.naturalWidth;
  state.sourceHeight = img.naturalHeight;

  const mode = document.querySelector("input[name='mode']:checked")?.value || "mono";
  state.mode = mode;
  const result = mode === "embed"
    ? embedToSvg(img)
    : traceToSvg(img, mode, {
      detail: els.detail.value,
      threshold: els.threshold.value,
      noise: els.noise.value,
    });

  state.svg = result.svg;
  if (els.originalPreview) {
    els.originalPreview.innerHTML = `<img alt="Original PNG preview" src="${state.sourceDataUrl}">`;
  }
  if (els.svgPreview) {
    els.svgPreview.innerHTML = result.svg;
  }
  if (els.svgCode) {
    els.svgCode.textContent = result.svg.slice(0, 1800);
  }
  if (els.stats) {
    const bytes = new Blob([result.svg], { type: "image/svg+xml" }).size;
    els.stats.innerHTML = `
      <div class="stat"><span>Input</span><strong>${img.naturalWidth}x${img.naturalHeight}</strong></div>
      <div class="stat"><span>Sample</span><strong>${result.sampled}</strong></div>
      <div class="stat"><span>SVG</span><strong>${Math.max(1, Math.round(bytes / 1024))} KB</strong></div>
      <div class="stat"><span>Nodes</span><strong>${result.nodeCount}</strong></div>
    `;
  }
  renderIconPreview(img);
  if (els.download) els.download.disabled = false;
  if (els.downloadIcon) els.downloadIcon.disabled = false;
  if (els.copy) els.copy.disabled = false;
}

async function handleFile(file) {
  if (!file) return;
  if (file.type !== "image/png") {
    alert("Please choose a PNG file.");
    return;
  }
  state.fileName = file.name.replace(/\.png$/i, "");
  state.sourceDataUrl = await readFile(file);
  await renderConversion();
}

function downloadSvg() {
  if (!state.svg) return;
  const blob = new Blob([state.svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.fileName || "converted"}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function canvasToPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Could not render icon image."));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value, true);
}

async function makeIcoBlob(img) {
  const images = [];
  for (const size of ICON_SIZES) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    drawContainedImage(canvas.getContext("2d"), img, size);
    images.push({ size, bytes: await canvasToPngBytes(canvas) });
  }

  const headerSize = 6;
  const entrySize = 16;
  let imageOffset = headerSize + entrySize * images.length;
  const totalBytes = imageOffset + images.reduce((sum, image) => sum + image.bytes.length, 0);
  const output = new Uint8Array(totalBytes);
  const view = new DataView(output.buffer);

  writeUint16(view, 0, 0);
  writeUint16(view, 2, 1);
  writeUint16(view, 4, images.length);

  images.forEach((image, index) => {
    const entryOffset = headerSize + entrySize * index;
    output[entryOffset] = image.size === 256 ? 0 : image.size;
    output[entryOffset + 1] = image.size === 256 ? 0 : image.size;
    output[entryOffset + 2] = 0;
    output[entryOffset + 3] = 0;
    writeUint16(view, entryOffset + 4, 1);
    writeUint16(view, entryOffset + 6, 32);
    writeUint32(view, entryOffset + 8, image.bytes.length);
    writeUint32(view, entryOffset + 12, imageOffset);
    output.set(image.bytes, imageOffset);
    imageOffset += image.bytes.length;
  });

  return new Blob([output], { type: "image/x-icon" });
}

async function downloadIcon() {
  if (!state.sourceDataUrl) return;
  const img = await loadImage(state.sourceDataUrl);
  const blob = await makeIcoBlob(img);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.fileName || "icon"}.ico`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copySvg() {
  if (!state.svg) return;
  await navigator.clipboard.writeText(state.svg);
  if (!els.copy) return;
  const old = els.copy.textContent;
  els.copy.textContent = "Copied";
  window.setTimeout(() => {
    els.copy.textContent = old;
  }, 1200);
}

function createSamplePng() {
  const canvas = document.createElement("canvas");
  canvas.width = 220;
  canvas.height = 220;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 220, 220);
  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.roundRect(36, 38, 148, 148, 28);
  ctx.fill();
  ctx.fillStyle = "#22c55e";
  ctx.beginPath();
  ctx.moveTo(110, 62);
  ctx.lineTo(154, 150);
  ctx.lineTo(66, 150);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#67e8f9";
  ctx.beginPath();
  ctx.arc(110, 122, 18, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL("image/png");
}

async function useSample() {
  state.fileName = "pngtosvg-sample";
  state.sourceDataUrl = createSamplePng();
  await renderConversion();
}

function bindEvents() {
  els.chooseButtons.forEach((button) => {
    button.addEventListener("click", () => els.fileInput?.click());
  });
  els.sampleButtons.forEach((button) => {
    button.addEventListener("click", useSample);
  });
  els.fileInput?.addEventListener("change", (event) => {
    handleFile(event.target.files?.[0]);
  });

  if (els.dropZone) {
    ["dragenter", "dragover"].forEach((type) => {
      els.dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        els.dropZone.classList.add("dragging");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      els.dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        els.dropZone.classList.remove("dragging");
      });
    });
    els.dropZone.addEventListener("drop", (event) => {
      handleFile(event.dataTransfer?.files?.[0]);
    });
  }

  [els.detail, els.threshold, els.noise].forEach((input) => {
    input?.addEventListener("input", renderConversion);
  });
  els.modeInputs.forEach((input) => {
    input.addEventListener("change", renderConversion);
  });
  els.download?.addEventListener("click", downloadSvg);
  els.downloadIcon?.addEventListener("click", downloadIcon);
  els.copy?.addEventListener("click", copySvg);
  els.reset?.addEventListener("click", () => {
    state.fileName = "";
    state.sourceDataUrl = "";
    state.svg = "";
    if (els.fileInput) els.fileInput.value = "";
    setEmptyPreview();
  });
}

updateRangeLabels();
setEmptyPreview();
bindEvents();
