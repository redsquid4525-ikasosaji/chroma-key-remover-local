(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const dropZone = $("dropZone");
  const fileInput = $("fileInput");
  const originalCanvas = $("originalCanvas");
  const resultCanvas = $("resultCanvas");
  const resultDrop = $("resultDrop");
  const cropStage = $("cropStage");
  const cropOverlay = $("cropOverlay");
  const cropBox = $("cropBox");
  const originalInfo = $("originalInfo");
  const resultInfo = $("resultInfo");
  const downloadLink = $("downloadLink");
  const statusEl = $("status");
  const resetButton = $("resetButton");
  const copyButton = $("copyButton");
  const autoCropButton = $("autoCropButton");
  const resetCropButton = $("resetCropButton");

  const cropInputs = {
    x: $("cropX"),
    y: $("cropY"),
    w: $("cropW"),
    h: $("cropH"),
  };

  const inputs = {
    greenMin: $("greenMin"),
    greenStrength: $("greenStrength"),
    greenRatio: $("greenRatio"),
    edgeSoftness: $("edgeSoftness"),
    despill: $("despill"),
    cleanup: $("cleanup"),
  };

  const values = {
    greenMin: $("greenMinValue"),
    greenStrength: $("greenStrengthValue"),
    greenRatio: $("greenRatioValue"),
    edgeSoftness: $("edgeSoftnessValue"),
  };

  const defaults = {
    greenMin: 120,
    greenStrength: 55,
    greenRatio: 0.43,
    edgeSoftness: 1.0,
    despill: true,
    cleanup: true,
  };

  const state = {
    bitmap: null,
    fileName: "transparent.png",
    objectUrl: null,
    outputBlob: null,
    outputFileName: "transparent.png",
    processedCanvas: document.createElement("canvas"),
    exportCanvas: document.createElement("canvas"),
    crop: { x: 0, y: 0, w: 1, h: 1 },
    cropDrag: null,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function updateLabels() {
    values.greenMin.textContent = String(inputs.greenMin.value);
    values.greenStrength.textContent = String(inputs.greenStrength.value);
    values.greenRatio.textContent = Number(inputs.greenRatio.value).toFixed(2);
    values.edgeSoftness.textContent = Number(inputs.edgeSoftness.value).toFixed(2);
  }

  function getParams() {
    return {
      greenMin: Number(inputs.greenMin.value),
      greenStrength: Number(inputs.greenStrength.value),
      greenRatio: Number(inputs.greenRatio.value),
      edgeSoftness: Number(inputs.edgeSoftness.value),
      despill: inputs.despill.checked,
      cleanup: inputs.cleanup.checked,
    };
  }

  function resetControls() {
    inputs.greenMin.value = defaults.greenMin;
    inputs.greenStrength.value = defaults.greenStrength;
    inputs.greenRatio.value = defaults.greenRatio;
    inputs.edgeSoftness.value = defaults.edgeSoftness;
    inputs.despill.checked = defaults.despill;
    inputs.cleanup.checked = defaults.cleanup;
    updateLabels();
    processCurrentImage();
  }

  function makeOutputFileName(fileName) {
    const safe = fileName.replace(/\.[^.]+$/, "");
    return `${safe || "image"}_transparent.png`;
  }

  function setDownload(blob, fileName) {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
    }
    state.objectUrl = URL.createObjectURL(blob);
    state.outputBlob = blob;
    state.outputFileName = makeOutputFileName(fileName);
    downloadLink.href = state.objectUrl;
    downloadLink.download = state.outputFileName;
    downloadLink.classList.remove("disabled");
    downloadLink.setAttribute("aria-disabled", "false");
  }

  function setCropEnabled(enabled) {
    for (const input of Object.values(cropInputs)) {
      input.disabled = !enabled;
    }
    copyButton.disabled = !enabled;
    autoCropButton.disabled = !enabled;
    resetCropButton.disabled = !enabled;
  }

  function syncCropInputs() {
    const source = state.processedCanvas;
    cropInputs.x.max = Math.max(0, source.width - 1);
    cropInputs.y.max = Math.max(0, source.height - 1);
    cropInputs.w.max = Math.max(1, source.width - state.crop.x);
    cropInputs.h.max = Math.max(1, source.height - state.crop.y);
    cropInputs.x.value = state.crop.x;
    cropInputs.y.value = state.crop.y;
    cropInputs.w.value = state.crop.w;
    cropInputs.h.value = state.crop.h;
  }

  function getDisplayMetrics() {
    const source = state.processedCanvas;
    const rect = resultCanvas.getBoundingClientRect();
    const scaleX = rect.width / Math.max(1, source.width);
    const scaleY = rect.height / Math.max(1, source.height);
    return { rect, scaleX, scaleY };
  }

  function updateCropOverlay() {
    const source = state.processedCanvas;
    if (!source.width || !source.height) {
      cropOverlay.classList.add("is-hidden");
      return;
    }

    const { rect, scaleX, scaleY } = getDisplayMetrics();
    cropStage.style.width = `${rect.width}px`;
    cropStage.style.height = `${rect.height}px`;
    cropOverlay.classList.remove("is-hidden");

    const left = state.crop.x * scaleX;
    const top = state.crop.y * scaleY;
    const width = state.crop.w * scaleX;
    const height = state.crop.h * scaleY;
    const right = Math.max(0, rect.width - left - width);
    const bottom = Math.max(0, rect.height - top - height);

    cropBox.style.left = `${left}px`;
    cropBox.style.top = `${top}px`;
    cropBox.style.width = `${width}px`;
    cropBox.style.height = `${height}px`;
    cropOverlay.style.setProperty("--crop-left", `${left}px`);
    cropOverlay.style.setProperty("--crop-top", `${top}px`);
    cropOverlay.style.setProperty("--crop-right", `${right}px`);
    cropOverlay.style.setProperty("--crop-bottom", `${bottom}px`);
  }

  function normalizeCrop(crop) {
    const source = state.processedCanvas;
    const maxW = Math.max(1, source.width);
    const maxH = Math.max(1, source.height);
    const x = clamp(Math.round(crop.x) || 0, 0, maxW - 1);
    const y = clamp(Math.round(crop.y) || 0, 0, maxH - 1);
    const w = clamp(Math.round(crop.w) || 1, 1, maxW - x);
    const h = clamp(Math.round(crop.h) || 1, 1, maxH - y);
    return { x, y, w, h };
  }

  function setCrop(crop) {
    state.crop = normalizeCrop(crop);
    syncCropInputs();
    updateCropOverlay();
    updateExportBlob();
  }

  function setFullCrop() {
    setCrop({
      x: 0,
      y: 0,
      w: state.processedCanvas.width || 1,
      h: state.processedCanvas.height || 1,
    });
  }

  function findOpaqueBounds() {
    const source = state.processedCanvas;
    const ctx = source.getContext("2d", { willReadFrequently: true });
    const { width, height } = source;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return { x: 0, y: 0, w: width, h: height };
    }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(blob);
    });
  }

  function renderFullResult() {
    const source = state.processedCanvas;
    if (!source.width || !source.height) {
      return;
    }

    const ctx = resultCanvas.getContext("2d", { willReadFrequently: false });
    resultCanvas.width = source.width;
    resultCanvas.height = source.height;
    ctx.clearRect(0, 0, source.width, source.height);
    ctx.drawImage(source, 0, 0);
    updateCropOverlay();
  }

  async function updateExportBlob() {
    const source = state.processedCanvas;
    if (!source.width || !source.height) {
      return;
    }

    const crop = normalizeCrop(state.crop);
    const exportCanvas = state.exportCanvas;
    const ctx = exportCanvas.getContext("2d", { willReadFrequently: false });
    exportCanvas.width = crop.w;
    exportCanvas.height = crop.h;
    ctx.clearRect(0, 0, crop.w, crop.h);
    ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

    resultInfo.textContent = `${crop.w} × ${crop.h}px`;
    const blob = await canvasToPngBlob(exportCanvas);
    if (!blob) {
      setStatus("PNGの作成に失敗しました。");
      return;
    }
    setDownload(blob, state.fileName);
    setStatus("完了。矩形範囲をダウンロード、ドラッグできます。");
  }

  function renderOriginal(bitmap) {
    const ctx = originalCanvas.getContext("2d", { willReadFrequently: false });
    originalCanvas.width = bitmap.width;
    originalCanvas.height = bitmap.height;
    ctx.clearRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    originalInfo.textContent = `${bitmap.width} × ${bitmap.height}px`;
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("画像ファイルを選択してください。");
      return;
    }

    setStatus("画像を読み込み中...");
    const bitmap = await createImageBitmap(file);
    state.bitmap = bitmap;
    state.fileName = file.name || "image.png";
    state.crop = { x: 0, y: 0, w: bitmap.width, h: bitmap.height };

    renderOriginal(bitmap);
    await processCurrentImage();
  }

  async function processCurrentImage() {
    if (!state.bitmap) {
      updateLabels();
      return;
    }

    updateLabels();
    const bitmap = state.bitmap;
    const params = getParams();

    setStatus("緑抜き処理中...");

    const fullCanvas = state.processedCanvas;
    const ctx = fullCanvas.getContext("2d", { willReadFrequently: true });
    fullCanvas.width = bitmap.width;
    fullCanvas.height = bitmap.height;
    ctx.clearRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    applyChromaKey(imageData, bitmap.width, bitmap.height, params);
    ctx.putImageData(imageData, 0, 0);

    setCropEnabled(true);
    if (state.crop.w > bitmap.width || state.crop.h > bitmap.height) {
      state.crop = { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
    }
    renderFullResult();
    setCrop(state.crop);
  }

  function applyChromaKey(imageData, width, height, params) {
    const data = imageData.data;
    const totalPixels = width * height;

    // Python版の式をJSへ移植:
    // green_strength = g - max(r,b)
    // green_ratio = g / (r+g+b)
    // core green => alpha 0
    // soft edge => alphaを段階的に下げる
    for (let i = 0; i < totalPixels; i++) {
      const p = i * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const a = data[p + 3];

      const maxRb = Math.max(r, b);
      const greenStrength = g - maxRb;
      const greenRatio = g / (r + g + b + 0.000001);

      const core =
        g > params.greenMin &&
        greenStrength > params.greenStrength &&
        greenRatio > params.greenRatio;

      if (core) {
        data[p + 3] = 0;
        continue;
      }

      const softA = clamp((greenStrength - 25) / 70, 0, 1);
      const softB = clamp((greenRatio - 0.34) / 0.18, 0, 1);
      const soft = clamp(softA * softB * params.edgeSoftness, 0, 1);

      if (soft > 0) {
        data[p + 3] = Math.round(a * (1 - soft));
      }

      if (params.despill) {
        const newAlpha = data[p + 3];
        const shouldDespill =
          newAlpha > 0 &&
          greenStrength > 15 &&
          greenRatio > 0.32;

        if (shouldDespill) {
          data[p + 1] = Math.min(g, maxRb + 10);
        }
      }
    }

    if (params.cleanup) {
      medianFilterAlpha(data, width, height);
    }
  }

  function medianFilterAlpha(data, width, height) {
    const alpha = new Uint8ClampedArray(width * height);
    for (let i = 0; i < alpha.length; i++) {
      alpha[i] = data[i * 4 + 3];
    }

    const sorted = new Array(9);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let k = 0;
        for (let yy = -1; yy <= 1; yy++) {
          for (let xx = -1; xx <= 1; xx++) {
            sorted[k++] = alpha[(y + yy) * width + (x + xx)];
          }
        }
        sorted.sort((a, b) => a - b);
        data[(y * width + x) * 4 + 3] = sorted[4];
      }
    }
  }

  function debounce(fn, delay = 120) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  const debouncedProcess = debounce(processCurrentImage, 120);

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", (event) => {
    handleFile(event.target.files?.[0]);
  });

  ["dragenter", "dragover"].forEach((name) => {
    dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((name) => {
    dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove("dragover");
    });
  });

  dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    handleFile(file);
  });

  for (const input of Object.values(inputs)) {
    input.addEventListener("input", () => {
      updateLabels();
      debouncedProcess();
    });
    input.addEventListener("change", () => {
      updateLabels();
      debouncedProcess();
    });
  }

  resetButton.addEventListener("click", resetControls);

  autoCropButton.addEventListener("click", () => {
    if (!state.bitmap) {
      return;
    }
    setCrop(findOpaqueBounds());
  });

  resetCropButton.addEventListener("click", () => {
    if (!state.bitmap) {
      return;
    }
    setFullCrop();
  });

  copyButton.addEventListener("click", async () => {
    if (!state.outputBlob) {
      return;
    }
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      setStatus("このブラウザでは画像コピーに対応していません。");
      return;
    }

    try {
      copyButton.disabled = true;
      const dataUrl = await blobToDataUrl(state.outputBlob);
      const htmlBlob = new Blob(
        [`<img src="${dataUrl}" alt="${state.outputFileName}">`],
        { type: "text/html" },
      );
      const textBlob = new Blob([state.outputFileName], { type: "text/plain" });
      const itemData = {
        "image/png": state.outputBlob,
        "text/html": htmlBlob,
        "text/plain": textBlob,
      };
      const supportedItemData = Object.fromEntries(
        Object.entries(itemData).filter(([type]) => {
          return !ClipboardItem.supports || ClipboardItem.supports(type);
        }),
      );

      await navigator.clipboard.write([
        new ClipboardItem(supportedItemData),
      ]);
      setStatus("クロップ範囲をクリップボードにコピーしました。");
    } catch {
      setStatus("コピーできませんでした。ブラウザの権限やHTTPS/localhost条件を確認してください。");
    } finally {
      copyButton.disabled = !state.outputBlob;
    }
  });

  for (const [key, input] of Object.entries(cropInputs)) {
    input.addEventListener("change", () => {
      setCrop({ ...state.crop, [key]: Number(input.value) });
    });
  }

  function getCropPoint(event) {
    const { rect, scaleX, scaleY } = getDisplayMetrics();
    return {
      x: clamp((event.clientX - rect.left) / scaleX, 0, state.processedCanvas.width),
      y: clamp((event.clientY - rect.top) / scaleY, 0, state.processedCanvas.height),
    };
  }

  function cropFromDrag(startCrop, dx, dy, handle) {
    const source = state.processedCanvas;
    let x1 = startCrop.x;
    let y1 = startCrop.y;
    let x2 = startCrop.x + startCrop.w;
    let y2 = startCrop.y + startCrop.h;

    if (handle === "move") {
      const x = clamp(startCrop.x + dx, 0, source.width - startCrop.w);
      const y = clamp(startCrop.y + dy, 0, source.height - startCrop.h);
      return { x, y, w: startCrop.w, h: startCrop.h };
    }

    if (handle.includes("w")) {
      x1 += dx;
    }
    if (handle.includes("e")) {
      x2 += dx;
    }
    if (handle.includes("n")) {
      y1 += dy;
    }
    if (handle.includes("s")) {
      y2 += dy;
    }

    x1 = clamp(x1, 0, source.width - 1);
    y1 = clamp(y1, 0, source.height - 1);
    x2 = clamp(x2, 1, source.width);
    y2 = clamp(y2, 1, source.height);

    if (x2 <= x1) {
      if (handle.includes("w")) {
        x1 = x2 - 1;
      } else {
        x2 = x1 + 1;
      }
    }
    if (y2 <= y1) {
      if (handle.includes("n")) {
        y1 = y2 - 1;
      } else {
        y2 = y1 + 1;
      }
    }

    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  cropBox.addEventListener("pointerdown", (event) => {
    if (!state.bitmap) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const point = getCropPoint(event);
    state.cropDrag = {
      handle: event.target.dataset.handle || "move",
      pointerId: event.pointerId,
      startPoint: point,
      startCrop: { ...state.crop },
    };
    cropBox.setPointerCapture(event.pointerId);
  });

  cropBox.addEventListener("pointermove", (event) => {
    if (!state.cropDrag || state.cropDrag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const point = getCropPoint(event);
    const dx = point.x - state.cropDrag.startPoint.x;
    const dy = point.y - state.cropDrag.startPoint.y;
    setCrop(cropFromDrag(state.cropDrag.startCrop, dx, dy, state.cropDrag.handle));
  });

  function endCropDrag(event) {
    if (!state.cropDrag || state.cropDrag.pointerId !== event.pointerId) {
      return;
    }
    state.cropDrag = null;
  }

  cropBox.addEventListener("pointerup", endCropDrag);
  cropBox.addEventListener("pointercancel", endCropDrag);
  window.addEventListener("resize", updateCropOverlay);

  function handleResultDragStart(event) {
    if (!state.outputBlob || downloadLink.classList.contains("disabled")) {
      event.preventDefault();
      return;
    }

    const file = new File([state.outputBlob], state.outputFileName, {
      type: "image/png",
      lastModified: Date.now(),
    });

    event.dataTransfer.effectAllowed = "copy";
    try {
      event.dataTransfer.items.add(file);
    } catch {
      // Some browsers reject File items for outbound drags; URL fallbacks below still help.
    }
    event.dataTransfer.setData(
      "DownloadURL",
      `image/png:${state.outputFileName}:${state.objectUrl}`,
    );
    event.dataTransfer.setData("text/uri-list", state.objectUrl);
    event.dataTransfer.setData("text/plain", state.objectUrl);
  }

  resultCanvas.addEventListener("dragstart", handleResultDragStart);
  resultDrop.addEventListener("dragstart", handleResultDragStart);

  setCropEnabled(false);
  updateLabels();
})();
