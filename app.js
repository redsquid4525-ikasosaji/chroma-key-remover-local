(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const dropZone = $("dropZone");
  const fileInput = $("fileInput");
  const originalCanvas = $("originalCanvas");
  const resultCanvas = $("resultCanvas");
  const originalInfo = $("originalInfo");
  const resultInfo = $("resultInfo");
  const downloadLink = $("downloadLink");
  const statusEl = $("status");
  const resetButton = $("resetButton");

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
    downloadLink.href = state.objectUrl;
    downloadLink.download = makeOutputFileName(fileName);
    downloadLink.classList.remove("disabled");
    downloadLink.setAttribute("aria-disabled", "false");
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

    const ctx = resultCanvas.getContext("2d", { willReadFrequently: true });
    resultCanvas.width = bitmap.width;
    resultCanvas.height = bitmap.height;
    ctx.clearRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    applyChromaKey(imageData, bitmap.width, bitmap.height, params);
    ctx.putImageData(imageData, 0, 0);

    resultInfo.textContent = `${bitmap.width} × ${bitmap.height}px`;

    resultCanvas.toBlob((blob) => {
      if (!blob) {
        setStatus("PNGの作成に失敗しました。");
        return;
      }
      setDownload(blob, state.fileName);
      setStatus("完了。PNGをダウンロードできます。");
    }, "image/png");
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

  updateLabels();
})();
