const canvasCache = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHex(value, fallback = "#c8d0d8") {
  const raw = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
}

function hexToRgb(value) {
  const hex = normalizeHex(value).slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex(color = {}) {
  return `#${[color.r, color.g, color.b]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixHex(left, right, amount) {
  const mix = clamp(Number(amount) || 0, 0, 1);
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  return rgbToHex({
    r: a.r + (b.r - a.r) * mix,
    g: a.g + (b.g - a.g) * mix,
    b: a.b + (b.b - a.b) * mix,
  });
}

function ensurePatternCanvas(preset, color) {
  const cacheKey = `${preset}:${normalizeHex(color)}`;
  if (canvasCache.has(cacheKey)) {
    return canvasCache.get(cacheKey);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const baseColor = normalizeHex(color);
  const dark = mixHex(baseColor, "#111111", 0.26);
  const darker = mixHex(baseColor, "#000000", 0.42);
  const light = mixHex(baseColor, "#ffffff", 0.2);
  const bright = mixHex(baseColor, "#ffffff", 0.36);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = preset === "glass" ? "rgba(255,255,255,0.22)" : baseColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (preset === "grass") {
    context.fillStyle = dark;
    for (let x = 0; x < canvas.width; x += 10) {
      for (let y = 0; y < canvas.height; y += 14) {
        context.fillRect(x + ((y / 14) % 2 ? 2 : 0), y, 2, 6);
        context.fillRect(x + 4, y + 4, 2, 8);
      }
    }
    context.fillStyle = bright;
    for (let x = 2; x < canvas.width; x += 16) {
      for (let y = 2; y < canvas.height; y += 18) {
        context.fillRect(x, y, 1, 4);
        context.fillRect(x + 5, y + 6, 1, 5);
      }
    }
  } else if (preset === "wood" || preset === "floor") {
    const plankHeight = preset === "floor" ? 18 : 14;
    for (let y = 0; y < canvas.height; y += plankHeight) {
      context.fillStyle = y % (plankHeight * 2) === 0 ? dark : light;
      context.fillRect(0, y, canvas.width, plankHeight - 2);
      context.fillStyle = darker;
      context.fillRect(0, y + plankHeight - 2, canvas.width, 2);
      context.strokeStyle = mixHex(baseColor, "#2a1608", 0.34);
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(0, y + 4);
      context.bezierCurveTo(24, y + 2, 44, y + 10, 72, y + 5);
      context.bezierCurveTo(92, y + 1, 108, y + 8, 128, y + 3);
      context.stroke();
      context.beginPath();
      context.arc(18 + (y % 24), y + plankHeight / 2, 2.5, 0, Math.PI * 2);
      context.stroke();
    }
  } else if (preset === "wall") {
    const brickWidth = 28;
    const brickHeight = 14;
    for (let row = 0; row < canvas.height / brickHeight; row += 1) {
      const offset = row % 2 === 0 ? 0 : brickWidth / 2;
      for (let x = -offset; x < canvas.width; x += brickWidth) {
        context.fillStyle = row % 2 === 0 ? light : dark;
        context.fillRect(x + 1, row * brickHeight + 1, brickWidth - 3, brickHeight - 3);
      }
    }
    context.strokeStyle = darker;
    context.lineWidth = 2;
    for (let y = 0; y <= canvas.height; y += brickHeight) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
    for (let row = 0; row < canvas.height / brickHeight; row += 1) {
      const offset = row % 2 === 0 ? 0 : brickWidth / 2;
      for (let x = -offset; x < canvas.width; x += brickWidth) {
        context.beginPath();
        context.moveTo(x, row * brickHeight);
        context.lineTo(x, row * brickHeight + brickHeight);
        context.stroke();
      }
    }
  } else if (preset === "stone") {
    context.fillStyle = light;
    for (let index = 0; index < 80; index += 1) {
      const size = 1 + (index % 3);
      context.fillRect(
        (index * 17) % canvas.width,
        (index * 29) % canvas.height,
        size,
        size,
      );
    }
    context.strokeStyle = dark;
    context.lineWidth = 1.2;
    for (let index = 0; index < 14; index += 1) {
      const x = (index * 11) % canvas.width;
      const y = (index * 23) % canvas.height;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 8, y + 5);
      context.lineTo(x + 14, y + 1);
      context.stroke();
    }
  } else if (preset === "metal") {
    context.fillStyle = mixHex(baseColor, "#ffffff", 0.08);
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = mixHex(baseColor, "#ffffff", 0.32);
    context.lineWidth = 2;
    for (let x = -canvas.height; x < canvas.width; x += 18) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + canvas.height, canvas.height);
      context.stroke();
    }
    context.strokeStyle = darker;
    context.lineWidth = 1;
    for (let y = 10; y < canvas.height; y += 16) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
  } else if (preset === "fabric") {
    context.strokeStyle = dark;
    context.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 8) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    for (let y = 0; y < canvas.height; y += 8) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
  } else if (preset === "glass") {
    context.fillStyle = "rgba(255,255,255,0.12)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(255,255,255,0.25)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, 24);
    context.lineTo(canvas.width, 0);
    context.moveTo(0, 72);
    context.lineTo(canvas.width, 40);
    context.stroke();
  }

  canvasCache.set(cacheKey, canvas);
  return canvas;
}

function buildTexture(THREE, preset, color, repeatX, repeatY) {
  const canvas = ensurePatternCanvas(preset, color);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(Math.max(0.25, repeatX), Math.max(0.25, repeatY));
  texture.needsUpdate = true;
  return texture;
}

export function createPatternedMaterial(THREE, material = {}, options = {}) {
  const color = normalizeHex(material.color, "#c8d0d8");
  const preset = String(material.texture_preset ?? material.texturePreset ?? "none").trim().toLowerCase() || "none";
  const emissiveIntensity = clamp(Number(material.emissive_intensity ?? material.emissiveIntensity) || 0, 0, 8);
  const repeatX = Number(options.repeatX ?? 1) || 1;
  const repeatY = Number(options.repeatY ?? 1) || 1;
  const transparent = preset === "glass";
  const map = preset !== "none" ? buildTexture(THREE, preset, color, repeatX, repeatY) : null;
  return new THREE.MeshStandardMaterial({
    color: map ? "#ffffff" : color,
    map,
    roughness: preset === "metal" ? 0.34 : (preset === "glass" ? 0.12 : 0.76),
    metalness: preset === "metal" ? 0.68 : (preset === "glass" ? 0.08 : 0.06),
    emissive: emissiveIntensity > 0 ? color : "#000000",
    emissiveIntensity,
    transparent,
    opacity: transparent ? 0.72 : 1,
  });
}

export function clearPrivateWorldMaterialCaches() {
  canvasCache.clear();
}
