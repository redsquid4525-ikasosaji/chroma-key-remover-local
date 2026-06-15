(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const dropZone = $("dropZone");
  const fileInput = $("fileInput");
  const originalCanvas = $("originalCanvas");
  const resultCanvas = $("resultCanvas");
  const resultDrop = $("resultDrop");
  const originalInfo = $("originalInfo");
  const resultInfo = $("resultInfo");
  const downloadLink = $("downloadLink");
  const statusEl = $("status");
  const resetButton = $("resetButton");
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
    crop: { x: 0, y: 0, w: 1, h: 1 },
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
    renderCroppedResult();
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

  async function renderCroppedResult() {
    const source = state.processedCanvas;
    if (!source.width || !source.height) {
      return;
    }

    const crop = normalizeCrop(state.crop);
    const ctx = resultCanvas.getContext("2d", { willReadFrequently: false });
    resultCanvas.width = crop.w;
    resultCanvas.height = crop.h;
    ctx.clearRect(0, 0, crop.w, crop.h);
    ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

    resultInfo.textContent = `${crop.w} × ${crop.h}px`;
    const blob = await canvasToPngBlob(resultCanvas);
    if (!blob) {
      setStatus("PNGの作成に失敗しました。");
      return;
    }
    setDownload(blob, state.fileName);
    setStatus("完了。PNGをトリミング、ダウンロード、ドラッグできます。");
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

  for (const [key, input] of Object.entries(cropInputs)) {
    input.addEventListener("change", () => {
      setCrop({ ...state.crop, [key]: Number(input.value) });
    });
  }

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
