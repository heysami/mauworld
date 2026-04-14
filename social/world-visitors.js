import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";

const SOLO_THOUGHT_EMOJIS = ["🤔", "💭"];
const PAIR_EMOJIS = ["...", "🙂", "😐", "😄", "😕"];
const GROUP_CALM_EMOJIS = ["...", "🙂", "😐", "🤔", "💬"];
const GROUP_HIGH_ENERGY_EMOJIS = ["😆", "🤩", "😡"];
const HIGH_ENERGY_EMOJIS = new Set(GROUP_HIGH_ENERGY_EMOJIS);
const HIGH_ENERGY_EMOTIONS = new Set(["joy", "ecstasy", "anger", "rage", "surprise", "amazement"]);
const QUEUED_EMOTION_EMOJIS = new Map([
  ["joy", ["😄", "🙂"]],
  ["ecstasy", ["🤩", "😆"]],
  ["anger", ["😡", "😠"]],
  ["rage", ["😡", "😠"]],
  ["surprise", ["😮", "🤩"]],
  ["amazement", ["🤩", "😲"]],
  ["fear", ["😟", "😬"]],
  ["trust", ["🙂", "💭"]],
  ["anticipation", ["🤔", "💭"]],
  ["interest", ["🤔", "🙂"]],
  ["admiration", ["🤩", "🙂"]],
  ["pensiveness", ["🤔", "💭"]],
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(angle) {
  let next = angle;
  while (next > Math.PI) {
    next -= Math.PI * 2;
  }
  while (next < -Math.PI) {
    next += Math.PI * 2;
  }
  return next;
}

function shortestAngleDelta(from, to) {
  return normalizeAngle(to - from);
}

function yawFromVector(vector) {
  return normalizeAngle(Math.atan2(-vector.x, -vector.z));
}

function getFlatForwardVector(yaw) {
  return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

function getPlanarRightVector(forward) {
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 0.000001) {
    return new THREE.Vector3(1, 0, 0);
  }
  return right.normalize();
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomInteger(min, max) {
  return Math.floor(randomBetween(min, max + 1));
}

function randomChoice(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return "";
  }
  return values[Math.floor(Math.random() * values.length)];
}

function disposeMaterial(material) {
  if (!material) {
    return;
  }
  if (material.map) {
    material.map.dispose();
  }
  material.dispose();
}

function disposeObject3D(root) {
  root.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose();
    }
    if (Array.isArray(node.material)) {
      node.material.forEach(disposeMaterial);
    } else {
      disposeMaterial(node.material);
    }
  });
}

function collectMaterialEntries(root) {
  const entries = [];
  root.traverse((node) => {
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      entries.push({
        material,
        baseOpacity: typeof material.opacity === "number" ? material.opacity : 1,
      });
      material.transparent = true;
    }
  });
  return entries;
}

function applyMaterialOpacity(entries, opacity) {
  for (const entry of entries) {
    entry.material.opacity = entry.baseOpacity * opacity;
  }
}

function drawRoundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function wrapBubbleText(context, value, maxWidth, maxLines = 4) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }
  const lines = [];
  let current = "";
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const candidate = current ? `${current} ${word}` : word;
    if (!current || context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) {
      break;
    }
  }
  if (current) {
    lines.push(current);
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
  }
  if (words.length > 0 && lines.length === maxLines) {
    const consumed = lines.join(" ").split(/\s+/).filter(Boolean).length;
    if (consumed < words.length) {
      let last = lines[maxLines - 1];
      while (last.length > 1 && context.measureText(`${last}...`).width > maxWidth) {
        last = last.slice(0, -1).trimEnd();
      }
      lines[maxLines - 1] = `${last}...`;
    }
  }
  return lines;
}

function createBubbleTexture(content, options = {}) {
  const width = options.width ?? 384;
  const height = options.height ?? 280;
  const thought = options.type === "thought";
  const hasText = typeof options.text === "string" && options.text.trim().length > 0;
  const accent = options.accent ?? "#2dd8ff";
  const stroke = options.stroke ?? "#33407a";
  const background = options.background ?? "rgba(255, 255, 255, 0.96)";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  context.clearRect(0, 0, width, height);
  context.save();
  context.shadowColor = "rgba(93, 109, 186, 0.22)";
  context.shadowBlur = 18;
  context.shadowOffsetY = 12;

  if (thought) {
    context.fillStyle = background;
    context.strokeStyle = stroke;
    context.lineWidth = 8;
    context.beginPath();
    context.arc(width * 0.5, height * 0.45, width * 0.28, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    for (const circle of [
      { x: width * 0.3, y: height * 0.76, radius: width * 0.045 },
      { x: width * 0.22, y: height * 0.88, radius: width * 0.028 },
    ]) {
      context.beginPath();
      context.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  } else {
    drawRoundedRect(context, 42, 26, width - 84, height - 90, 54);
    context.fillStyle = background;
    context.fill();
    context.lineWidth = 8;
    context.strokeStyle = stroke;
    context.stroke();

    context.beginPath();
    context.moveTo(width * 0.34, height - 70);
    context.lineTo(width * 0.43, height - 32);
    context.lineTo(width * 0.48, height - 82);
    context.closePath();
    context.fill();
    context.stroke();
  }

  context.restore();
  context.fillStyle = accent;
  context.fillRect(width * 0.26, 24, width * 0.48, 10);

  if (hasText) {
    const label = String(options.label ?? "").trim();
    const left = 64;
    const maxWidth = width - 128;
    if (label) {
      context.fillStyle = accent;
      context.textAlign = "left";
      context.textBaseline = "top";
      context.font = "800 28px Manrope, sans-serif";
      context.fillText(label, left, 56);
    }
    context.fillStyle = stroke;
    context.textAlign = "left";
    context.textBaseline = "top";
    context.font = "700 30px Manrope, sans-serif";
    const lines = wrapBubbleText(context, options.text, maxWidth, 4);
    const startY = label ? 100 : 78;
    lines.forEach((line, index) => {
      context.fillText(line, left, startY + index * 38);
    });
  } else {
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "112px \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Noto Color Emoji\", sans-serif";
    context.fillText(content, width * 0.5, thought ? height * 0.46 : height * 0.43);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createBubbleMesh(system, seed, root) {
  const bubble = system.createBillboard(
    createBubbleTexture("💭", {
      type: "thought",
      accent: system.pickAccent(`${seed}-bubble`, 1),
      stroke: system.worldStyle.outline,
    }),
    12.4,
    8.2,
    {
      opacity: 0,
      fog: false,
      depthTest: false,
      renderOrder: 12,
      persistent: true,
    },
  );
  bubble.visible = false;
  root.add(bubble);
  return {
    mesh: bubble,
    opacity: 0,
    targetOpacity: 0,
    duration: 0,
    elapsed: 0,
    currentKey: "",
    highEnergy: false,
    bounceCount: 0,
    label: "",
  };
}

function classifyBubbleEnergy(symbol) {
  return HIGH_ENERGY_EMOJIS.has(symbol);
}

function classifyEmotionEnergy(emotion) {
  return HIGH_ENERGY_EMOTIONS.has(String(emotion?.emotion_slug ?? "").trim().toLowerCase())
    && Number(emotion?.intensity ?? 0) >= 4;
}

function buildActor(system, seed, root, options = {}) {
  const mascot = system.createMascotFigure(seed, {
    scale: options.scale ?? 0.72,
    outlineColor: options.outlineColor ?? system.pickAccent(seed, 2),
  });
  root.add(mascot.group);
  const actor = {
    id: `actor-${system.actorCounter += 1}`,
    seed,
    group: mascot.group,
    poseRoot: mascot.poseRoot,
    halo: mascot.halo,
    orb: mascot.orb,
    orbBaseY: mascot.orb.position.y,
    materialEntries: collectMaterialEntries(mascot.group),
    bubble: createBubbleMesh(system, seed, root),
    position: new THREE.Vector3(),
    moveTarget: new THREE.Vector3(),
    moveSpeed: 12,
    visible: false,
    opacity: 0,
    targetOpacity: 0,
    facingYaw: 0,
    leanX: 0,
    leanZ: 0,
    targetLeanX: 0,
    targetLeanZ: 0,
    lastPosition: null,
    bobPhase: Math.random() * Math.PI * 2,
    bubbleLift: 13.4 + Math.random() * 0.8,
  };
  applyMaterialOpacity(actor.materialEntries, 0);
  return actor;
}

function setActorOpacity(actor, opacity) {
  actor.opacity = opacity;
  actor.group.visible = opacity > 0.01;
  applyMaterialOpacity(actor.materialEntries, opacity);
}

export function updateMascotMotion(actor, options = {}) {
  const deltaSeconds = options.deltaSeconds ?? 1 / 60;
  const elapsedSeconds = options.elapsedSeconds ?? 0;
  const actorPosition = actor.position ?? actor.group.position;
  const nextPosition = options.nextPosition ?? actorPosition;
  const maxSpeed = Math.max(0.0001, options.maxSpeed ?? 12);
  const currentFacingYaw = Number.isFinite(actor.facingYaw) ? actor.facingYaw : 0;
  const currentLeanX = Number.isFinite(actor.leanX) ? actor.leanX : 0;
  const currentLeanZ = Number.isFinite(actor.leanZ) ? actor.leanZ : 0;
  const bobPhase = Number.isFinite(actor.bobPhase) ? actor.bobPhase : 0;
  const visibleOpacity = Number.isFinite(actor.opacity) ? actor.opacity : 1;
  const movement =
    actor.lastPosition == null
      ? new THREE.Vector3()
      : nextPosition.clone().sub(actor.lastPosition);
  const movementLength = movement.length();
  const normalizedSpeed = clamp(movementLength / Math.max(deltaSeconds, 0.0001) / maxSpeed, 0, 1);
  let facingTarget = Number.isFinite(options.idleFacingYaw) ? options.idleFacingYaw : currentFacingYaw;

  if (movementLength > 0.000001 && options.faceMovement !== false) {
    facingTarget = normalizeAngle(yawFromVector(movement) + Math.PI);
  }

  const forward = options.movementBasisForward
    ? options.movementBasisForward.clone().setY(0).normalize()
    : getFlatForwardVector(facingTarget);
  const right = options.movementBasisRight
    ? options.movementBasisRight.clone().setY(0).normalize()
    : getPlanarRightVector(forward);
  const forwardAmount = movementLength > 0.000001
    ? clamp(movement.dot(forward) / movementLength, -1, 1) * normalizedSpeed
    : 0;
  const sideAmount = movementLength > 0.000001
    ? clamp(movement.dot(right) / movementLength, -1, 1) * normalizedSpeed
    : 0;
  const leanMix = 1 - Math.exp(-deltaSeconds * (options.leanResponse ?? 9));
  actor.targetLeanX = forwardAmount * (options.leanXFactor ?? 0.26);
  actor.targetLeanZ = sideAmount * (options.leanZFactor ?? 0.22);
  actor.leanX = currentLeanX + (actor.targetLeanX - currentLeanX) * leanMix;
  actor.leanZ = currentLeanZ + (actor.targetLeanZ - currentLeanZ) * leanMix;

  actor.facingYaw = normalizeAngle(
    currentFacingYaw + shortestAngleDelta(currentFacingYaw, facingTarget) * (1 - Math.exp(-deltaSeconds * (options.facingResponse ?? 9))),
  );
  actor.group.rotation.y = actor.facingYaw;

  const bobAmplitude = options.bobAmplitude ?? 0.14;
  const bobSpeed = options.bobSpeed ?? 1.6;
  if (actor.position) {
    actor.position.copy(nextPosition);
  }
  actor.group.position.copy(nextPosition);
  actor.group.position.y += Math.sin(elapsedSeconds * bobSpeed + bobPhase) * bobAmplitude * Math.max(visibleOpacity, 0.25);

  if (actor.poseRoot) {
    actor.poseRoot.rotation.x = actor.leanX;
    actor.poseRoot.rotation.z = actor.leanZ;
  }
  if (actor.halo) {
    actor.halo.rotation.z += deltaSeconds * 1.12;
  }
  if (actor.orb) {
    actor.orb.position.y = actor.orbBaseY + Math.sin(elapsedSeconds * 1.8 + bobPhase) * 0.26;
  }
  actor.lastPosition = actor.lastPosition ?? nextPosition.clone();
  actor.lastPosition.copy(nextPosition);

  return {
    movementLength,
  };
}

function updateActorFade(actor, deltaSeconds) {
  actor.opacity += (actor.targetOpacity - actor.opacity) * (1 - Math.exp(-deltaSeconds * 8));
  if (Math.abs(actor.opacity - actor.targetOpacity) < 0.004) {
    actor.opacity = actor.targetOpacity;
  }
  setActorOpacity(actor, actor.opacity);
}

function showBubble(system, actor, options = {}) {
  const symbol = options.symbol || "💭";
  const bubbleType = options.type ?? "speech";
  const accent = options.accent ?? system.pickAccent(`${actor.seed}-bubble-${symbol}`, 1);
  const bubbleText = String(options.text ?? "").trim();
  const bubbleLabel = String(options.label ?? "").trim();
  const bubbleKey = `${bubbleType}:${symbol}:${bubbleText}:${bubbleLabel}:${accent}`;
  if (actor.bubble.currentKey !== bubbleKey) {
    const previousMap = actor.bubble.mesh.material.map;
    actor.bubble.mesh.material.map = createBubbleTexture(symbol, {
      type: bubbleType,
      accent,
      stroke: system.worldStyle.outline,
      text: bubbleText,
      label: bubbleLabel,
      width: bubbleText ? 560 : undefined,
      height: bubbleText ? 360 : undefined,
    });
    if (previousMap) {
      previousMap.dispose();
    }
    actor.bubble.currentKey = bubbleKey;
  }
  actor.bubble.mesh.visible = true;
  actor.bubble.targetOpacity = 1;
  actor.bubble.duration = options.duration ?? 1.5;
  actor.bubble.elapsed = 0;
  actor.bubble.highEnergy = Boolean(options.highEnergy);
  actor.bubble.bounceCount = options.bounceCount ?? (actor.bubble.highEnergy ? randomInteger(2, 3) : 0);
  actor.bubble.label = bubbleLabel;
}

function hideBubble(actor) {
  actor.bubble.targetOpacity = 0;
}

function updateBubble(actor, deltaSeconds) {
  actor.bubble.opacity += (actor.bubble.targetOpacity - actor.bubble.opacity) * (1 - Math.exp(-deltaSeconds * 10));
  if (Math.abs(actor.bubble.opacity - actor.bubble.targetOpacity) < 0.004) {
    actor.bubble.opacity = actor.bubble.targetOpacity;
  }
  if (actor.bubble.targetOpacity > 0) {
    actor.bubble.elapsed += deltaSeconds;
    if (actor.bubble.elapsed >= actor.bubble.duration) {
      hideBubble(actor);
    }
  }

  const bubbleLift =
    actor.bubble.highEnergy && actor.bubble.duration > 0
      ? Math.abs(Math.sin((actor.bubble.elapsed / actor.bubble.duration) * Math.PI * actor.bubble.bounceCount)) * 1.2
      : 0;

  actor.bubble.mesh.visible = actor.opacity > 0.01 && actor.bubble.opacity > 0.01;
  actor.bubble.mesh.position.copy(actor.position);
  actor.bubble.mesh.position.y += actor.bubbleLift + bubbleLift;
  actor.bubble.mesh.scale.setScalar(0.9 + actor.bubble.opacity * 0.12);
  actor.bubble.mesh.material.opacity = actor.bubble.opacity * actor.opacity;
}

function disposeActor(system, actor) {
  hideBubble(actor);
  if (actor.bubble?.mesh) {
    system.unregisterBillboard?.(actor.bubble.mesh, true);
    actor.bubble.mesh.parent?.remove(actor.bubble.mesh);
    if (actor.bubble.mesh.material?.map) {
      actor.bubble.mesh.material.map.dispose();
    }
    actor.bubble.mesh.geometry.dispose();
    actor.bubble.mesh.material.dispose();
  }
  actor.group.parent?.remove(actor.group);
  disposeObject3D(actor.group);
}

function buildRoutine(system, input) {
  const sourceKind = input.sourceKind ?? "ambient";
  const routineType = input.routineType ?? "solo";
  const memberCount =
    sourceKind === "queued"
      ? 1
      : routineType === "solo"
        ? 1
        : routineType === "pair"
          ? 2
          : randomChoice([3, 4]);
  const root = sourceKind === "queued" ? system.queuedRoot : system.ambientRoot;
  const routine = {
    id: `routine-${system.routineCounter += 1}`,
    sourceKind,
    routineType,
    phase: "idle",
    members: Array.from({ length: memberCount }, (_, index) =>
      buildActor(
        system,
        `${sourceKind}-${routineType}-${system.routineCounter}-${index}`,
        root,
        {
          scale: sourceKind === "queued" ? 0.82 : 0.72,
          outlineColor:
            sourceKind === "queued"
              ? system.pickAccent(`${input.focusKey ?? input.targetTagId ?? "queued"}-actor`, 0)
              : system.pickAccent(`${routineType}-${index}`, 2),
        },
      )),
    slots: [],
    targetTagId: input.targetTagId ?? null,
    targetAnchor: input.targetAnchor?.clone?.() ?? new THREE.Vector3(),
    focusKey: input.focusKey ?? null,
    focusResult: input.focusResult ?? null,
    loopsRemaining: 0,
    bubbleTurnsRemaining: 0,
    bubbleTurnIndex: 0,
    pauseRemaining: 0,
    cooldownRemaining: 0,
    moveReason: "spawn",
    exitChance: 0.3,
    requestedActive: true,
    randomPhase: Math.random() * Math.PI * 2,
    thoughtPassIndex: 0,
    interrupted: false,
  };
  for (const actor of routine.members) {
    actor.group.visible = false;
    actor.facingYaw = randomBetween(-Math.PI, Math.PI);
  }
  return routine;
}

function computeSlotsForRoutine(routine, anchor, options = {}) {
  const radius = options.radius ?? randomBetween(7.2, 9.4);
  const baseAngle = options.baseAngle ?? randomBetween(0, Math.PI * 2);
  if (routine.routineType === "solo" || routine.sourceKind === "queued") {
    return [new THREE.Vector3(
      anchor.x + Math.cos(baseAngle) * radius,
      anchor.y,
      anchor.z + Math.sin(baseAngle) * radius,
    )];
  }
  if (routine.routineType === "pair") {
    const spread = randomBetween(0.28, 0.42);
    return [-spread, spread].map((offset) => new THREE.Vector3(
      anchor.x + Math.cos(baseAngle + offset) * radius,
      anchor.y,
      anchor.z + Math.sin(baseAngle + offset) * radius,
    ));
  }
  const count = routine.members.length;
  return Array.from({ length: count }, (_, index) => {
    const angle = baseAngle + (index * (Math.PI * 2)) / count;
    return new THREE.Vector3(
      anchor.x + Math.cos(angle) * radius,
      anchor.y,
      anchor.z + Math.sin(angle) * radius,
    );
  });
}

function computeSpawnPosition(anchor, slot, index, sourceKind) {
  const outward = slot.clone().sub(anchor).setY(0);
  if (outward.lengthSq() < 0.000001) {
    outward.set(Math.cos(index), 0, Math.sin(index));
  } else {
    outward.normalize();
  }
  const travelDistance = sourceKind === "queued" ? randomBetween(16, 22) : randomBetween(14, 20);
  return slot.clone().addScaledVector(outward, travelDistance);
}

function computeExitPosition(anchor, slot) {
  const outward = slot.clone().sub(anchor).setY(0);
  if (outward.lengthSq() < 0.000001) {
    outward.set(1, 0, 0);
  } else {
    outward.normalize();
  }
  return slot.clone().addScaledVector(outward, randomBetween(12, 17));
}

function chooseBubbleSpec(routine, speakerIndex) {
  if (routine.sourceKind === "queued") {
    const emotions = Array.isArray(routine.focusResult?.post?.emotions) ? routine.focusResult.post.emotions : [];
    const ranked = [...emotions].sort((left, right) => Number(right.intensity ?? 0) - Number(left.intensity ?? 0));
    const primary = ranked[0] ?? null;
    const thoughtPasses = Array.isArray(routine.focusResult?.post?.thought_passes)
      ? routine.focusResult.post.thought_passes
      : Array.isArray(routine.focusResult?.post?.thoughtPasses)
        ? routine.focusResult.post.thoughtPasses
        : [];
    const currentPass =
      thoughtPasses.length > 0
        ? thoughtPasses[routine.thoughtPassIndex % thoughtPasses.length]
        : null;
    const symbols = QUEUED_EMOTION_EMOJIS.get(String(primary?.emotion_slug ?? "").trim().toLowerCase()) ?? SOLO_THOUGHT_EMOJIS;
    const symbol = randomChoice(symbols);
    const text = String(
      currentPass?.body_plain
      ?? currentPass?.bodyPlain
      ?? currentPass?.body_md
      ?? currentPass?.bodyMd
      ?? routine.focusResult?.post?.body_plain
      ?? routine.focusResult?.post?.bodyPlain
      ?? "",
    ).trim();
    const label = String(
      currentPass?.label
      ?? currentPass?.stage
      ?? "",
    ).trim();
    routine.thoughtPassIndex += 1;
    return {
      speakerIndex,
      symbol,
      text,
      label,
      type: "speech",
      duration: clamp(1.8 + text.length / 72, 1.8, 4.4),
      highEnergy: classifyEmotionEnergy(primary) || classifyBubbleEnergy(symbol),
      accent: routine.focusResult?.worldQueueStatus === "processing" ? "#2dd8ff" : "#ff4fa8",
    };
  }
  if (routine.routineType === "solo") {
    const symbol = randomChoice(SOLO_THOUGHT_EMOJIS);
    return {
      speakerIndex,
      symbol,
      type: "thought",
      duration: randomBetween(1.2, 1.6),
      highEnergy: false,
    };
  }
  if (routine.routineType === "pair") {
    const symbol = randomChoice(PAIR_EMOJIS);
    return {
      speakerIndex,
      symbol,
      type: "speech",
      duration: randomBetween(0.9, 1.35),
      highEnergy: classifyBubbleEnergy(symbol),
    };
  }
  const useHighEnergy = Math.random() < 0.28;
  const symbol = useHighEnergy
    ? randomChoice(GROUP_HIGH_ENERGY_EMOJIS)
    : randomChoice(GROUP_CALM_EMOJIS);
  return {
    speakerIndex,
    symbol,
    type: "speech",
    duration: randomBetween(1, 1.5),
    highEnergy: useHighEnergy,
  };
}

function chooseAmbientTarget(system, routine) {
  const available = [...system.tagAnchors.values()];
  if (available.length === 0) {
    return null;
  }
  const occupied = new Set(
    [...system.ambientRoutines.values()]
      .filter((entry) => entry !== routine && entry.requestedActive && entry.targetTagId)
      .map((entry) => entry.targetTagId),
  );
  const preferred = available.filter((entry) => !occupied.has(entry.id) && entry.id !== routine.targetTagId);
  const fallback = available.filter((entry) => entry.id !== routine.targetTagId);
  return randomChoice(preferred.length > 0 ? preferred : fallback.length > 0 ? fallback : available);
}

function beginMove(routine, anchorInfo, options = {}) {
  routine.targetTagId = anchorInfo?.id ?? routine.targetTagId;
  routine.targetAnchor.copy(anchorInfo?.position ?? routine.targetAnchor);
  routine.slots = computeSlotsForRoutine(routine, routine.targetAnchor, {
    radius: options.radius,
    baseAngle: options.baseAngle,
  });
  routine.phase = "move";
  routine.moveReason = options.reason ?? "retarget";
  routine.pauseRemaining = 0;
  routine.bubbleTurnsRemaining = 0;
  routine.bubbleTurnIndex = 0;
  const fadeIn = options.fadeIn ?? false;
  const fadeOut = options.fadeOut ?? false;
  for (let index = 0; index < routine.members.length; index += 1) {
    const actor = routine.members[index];
    const slot = routine.slots[index] ?? routine.slots[0];
    if (options.spawnOutside) {
      const start = computeSpawnPosition(routine.targetAnchor, slot, index, routine.sourceKind);
      actor.position.copy(start);
      actor.lastPosition = start.clone();
      actor.group.position.copy(start);
      if (fadeIn) {
        setActorOpacity(actor, 0);
      }
    }
    actor.moveTarget.copy(
      fadeOut ? computeExitPosition(routine.targetAnchor, slot) : slot,
    );
    actor.moveSpeed = options.moveSpeed ?? (routine.sourceKind === "queued" ? 17 : 14);
    actor.targetOpacity = fadeOut ? 0 : 1;
    actor.visible = true;
    actor.group.visible = true;
    if (!fadeOut && !fadeIn && actor.opacity < 0.02) {
      setActorOpacity(actor, 1);
    }
  }
}

function beginPause(routine) {
  routine.phase = "pause";
  routine.pauseRemaining =
    routine.sourceKind === "queued"
      ? randomBetween(0.8, 1.2)
      : routine.routineType === "group"
        ? randomBetween(1.9, 2.8)
        : randomBetween(0.9, 1.5);
}

function beginBubbleSequence(routine) {
  routine.phase = "bubble";
  routine.bubbleTurnsRemaining =
    routine.sourceKind === "queued"
      ? 1
      : routine.routineType === "solo"
        ? 1
        : routine.routineType === "pair"
          ? randomInteger(2, 5)
          : randomInteger(4, 10);
  routine.bubbleTurnIndex = 0;
  routine.activeBubbleActor = null;
}

function beginOrbitMove(routine) {
  routine.loopsRemaining = Math.max(0, routine.loopsRemaining - 1);
  beginMove(
    routine,
    {
      id: routine.targetTagId,
      position: routine.targetAnchor,
    },
    {
      reason: "orbit",
      moveSpeed: routine.sourceKind === "queued" ? 12 : 10.5,
    },
  );
}

function beginRetarget(routine, system) {
  const next = routine.sourceKind === "queued"
    ? {
      id: routine.targetTagId,
      position: routine.targetAnchor,
    }
    : chooseAmbientTarget(system, routine);
  if (!next) {
    beginExit(routine);
    return;
  }
  beginMove(routine, next, {
    reason: "retarget",
    moveSpeed: routine.sourceKind === "queued" ? 15 : 13,
  });
  routine.loopsRemaining = routine.sourceKind === "queued"
    ? randomInteger(1, 3)
    : routine.routineType === "solo"
      ? randomInteger(1, 4)
      : routine.routineType === "pair"
        ? randomInteger(1, 3)
        : randomInteger(1, 2);
}

function beginExit(routine) {
  routine.phase = "move";
  routine.moveReason = "exit";
  for (const actor of routine.members) {
    hideBubble(actor);
  }
  beginMove(
    routine,
    {
      id: routine.targetTagId,
      position: routine.targetAnchor,
    },
    {
      reason: "exit",
      fadeOut: true,
      moveSpeed: routine.sourceKind === "queued" ? 14 : 11,
    },
  );
}

function ensureRoutineStarted(routine, system) {
  if (routine.phase !== "idle") {
    return;
  }
  if (routine.sourceKind === "queued") {
    if (!routine.targetTagId) {
      return;
    }
    routine.loopsRemaining = randomInteger(1, 3);
    beginMove(
      routine,
      {
        id: routine.targetTagId,
        position: routine.targetAnchor,
      },
      {
        reason: "spawn",
        spawnOutside: true,
        fadeIn: true,
        moveSpeed: 15,
      },
    );
    return;
  }
  const target = chooseAmbientTarget(system, routine);
  if (!target) {
    return;
  }
  routine.loopsRemaining =
    routine.routineType === "solo"
      ? randomInteger(1, 4)
      : routine.routineType === "pair"
        ? randomInteger(1, 3)
        : randomInteger(1, 2);
  beginMove(routine, target, {
    reason: "spawn",
    spawnOutside: true,
    fadeIn: true,
  });
}

function updateRoutineFacing(routine) {
  if (routine.routineType === "solo" || routine.sourceKind === "queued") {
    return routine.members.map(() => yawFromVector(routine.targetAnchor.clone().sub(routine.members[0].position)) + Math.PI);
  }
  if (routine.routineType === "pair") {
    const first = routine.members[0]?.position ?? new THREE.Vector3();
    const second = routine.members[1]?.position ?? new THREE.Vector3();
    return [
      normalizeAngle(yawFromVector(second.clone().sub(first)) + Math.PI),
      normalizeAngle(yawFromVector(first.clone().sub(second)) + Math.PI),
    ];
  }
  const centroid = routine.members.reduce((acc, actor) => acc.add(actor.position), new THREE.Vector3())
    .multiplyScalar(1 / Math.max(1, routine.members.length));
  return routine.members.map((actor) => normalizeAngle(yawFromVector(centroid.clone().sub(actor.position)) + Math.PI));
}

function updateRoutineMotion(routine, deltaSeconds, elapsedSeconds) {
  const facingTargets = updateRoutineFacing(routine);
  for (let index = 0; index < routine.members.length; index += 1) {
    const actor = routine.members[index];
    const target = actor.moveTarget ?? actor.position;
    const delta = target.clone().sub(actor.position);
    const distance = delta.length();
    if (distance > 0.001) {
      const step = Math.min(distance, deltaSeconds * actor.moveSpeed);
      actor.position.addScaledVector(delta.normalize(), step);
    } else {
      actor.position.copy(target);
    }
    updateActorFade(actor, deltaSeconds);
    updateMascotMotion(actor, {
      deltaSeconds,
      elapsedSeconds,
      nextPosition: actor.position,
      maxSpeed: actor.moveSpeed,
      idleFacingYaw: facingTargets[index] ?? actor.facingYaw,
      bobAmplitude: 0.16,
      bobSpeed: 1.6,
    });
    updateBubble(actor, deltaSeconds);
  }
}

function routineReachedTargets(routine) {
  return routine.members.every((actor) => actor.position.distanceTo(actor.moveTarget) < 0.14);
}

function routineFullyHidden(routine) {
  return routine.members.every((actor) => actor.opacity < 0.02);
}

function advanceRoutineState(routine, system, deltaSeconds) {
  if (routine.phase === "idle") {
    ensureRoutineStarted(routine, system);
    return;
  }

  if (routine.phase === "move") {
    if (!routineReachedTargets(routine)) {
      return;
    }
    if (routine.moveReason === "exit") {
      if (!routineFullyHidden(routine)) {
        return;
      }
      if (!routine.requestedActive) {
        routine.phase = "done";
        return;
      }
      routine.phase = "cooldown";
      routine.cooldownRemaining = randomBetween(0.6, 1.4);
      return;
    }
    beginPause(routine);
    return;
  }

  if (routine.phase === "pause") {
    routine.pauseRemaining -= deltaSeconds;
    if (routine.pauseRemaining <= 0) {
      beginBubbleSequence(routine);
    }
    return;
  }

  if (routine.phase === "bubble") {
    const visibleBubbleActor = routine.members.find((actor) => actor.bubble.targetOpacity > 0 || actor.bubble.opacity > 0.02);
    if (!visibleBubbleActor && routine.bubbleTurnsRemaining > 0) {
      const speakerIndex =
        routine.routineType === "pair"
          ? routine.bubbleTurnIndex % 2
          : routine.routineType === "group"
            ? routine.bubbleTurnIndex % routine.members.length
            : 0;
      const bubbleSpec = chooseBubbleSpec(routine, speakerIndex);
      showBubble(system, routine.members[speakerIndex], bubbleSpec);
      routine.bubbleTurnsRemaining -= 1;
      routine.bubbleTurnIndex += 1;
      return;
    }
    if (visibleBubbleActor) {
      return;
    }
    if (routine.loopsRemaining > 0) {
      beginOrbitMove(routine);
      return;
    }
    if (routine.sourceKind === "queued") {
      if (routine.interrupted || !routine.requestedActive) {
        beginExit(routine);
      } else {
        routine.loopsRemaining = 1;
        beginOrbitMove(routine);
      }
      return;
    }
    if (Math.random() < routine.exitChance) {
      beginExit(routine);
      return;
    }
    beginRetarget(routine, system);
    return;
  }

  if (routine.phase === "cooldown") {
    routine.cooldownRemaining -= deltaSeconds;
    if (routine.cooldownRemaining <= 0) {
      routine.phase = "idle";
      if (routine.sourceKind === "queued") {
        routine.loopsRemaining = randomInteger(1, 3);
      }
    }
  }
}

export function createWorldVisitorSystem(options = {}) {
  const system = {
    ambientRoot: options.ambientRoot,
    queuedRoot: options.queuedRoot,
    createMascotFigure: options.createMascotFigure,
    createBillboard: options.createBillboard,
    unregisterBillboard: options.unregisterBillboard,
    pickAccent: options.pickAccent,
    worldStyle: options.worldStyle,
    tagAnchors: new Map(),
    ambientRoutines: new Map(),
    queuedRoutine: null,
    routineCounter: 0,
    actorCounter: 0,
  };

  function ensureAmbientRoutine(type) {
    if (!system.ambientRoutines.has(type)) {
      system.ambientRoutines.set(type, buildRoutine(system, {
        sourceKind: "ambient",
        routineType: type,
      }));
    }
    return system.ambientRoutines.get(type);
  }

  return {
    syncAmbient(tags = []) {
      system.tagAnchors = new Map(
        tags
          .filter((entry) => entry?.tag_id && Number.isFinite(entry.position_x) && Number.isFinite(entry.position_z))
          .map((entry) => [
            entry.tag_id,
            {
              id: entry.tag_id,
              position: new THREE.Vector3(entry.position_x, entry.position_y ?? 0, entry.position_z),
              tag: entry,
            },
          ]),
      );

      const desiredTypes =
        system.tagAnchors.size === 0
          ? []
          : system.tagAnchors.size < 3
            ? ["solo"]
            : system.tagAnchors.size < 6
              ? ["solo", "pair"]
              : ["solo", "pair", "group"];

      for (const [type, routine] of system.ambientRoutines.entries()) {
        routine.requestedActive = desiredTypes.includes(type);
        const targetMissing = routine.targetTagId && !system.tagAnchors.has(routine.targetTagId);
        if (!routine.requestedActive) {
          if (routine.phase === "idle" && routine.members.every((actor) => actor.opacity < 0.02)) {
            routine.phase = "done";
            continue;
          }
          if (routine.phase !== "move" || routine.moveReason !== "exit") {
            beginExit(routine);
          }
          continue;
        }
        if (targetMissing && routine.phase !== "move") {
          beginRetarget(routine, system);
        }
      }

      for (const type of desiredTypes) {
        const routine = ensureAmbientRoutine(type);
        routine.requestedActive = true;
      }
    },

    syncQueuedResult(result, options = {}) {
      const queuedActive = result?.destination
        && (result.worldQueueStatus === "queued" || result.worldQueueStatus === "processing");
      if (!queuedActive) {
        if (system.queuedRoutine) {
          system.queuedRoutine.requestedActive = false;
          if (system.queuedRoutine.phase !== "move" || system.queuedRoutine.moveReason !== "exit") {
            beginExit(system.queuedRoutine);
          }
        }
        return;
      }

      const focusKey = `${result.post?.id ?? "queued"}:${result.destination.tag_id}`;
      const anchor = new THREE.Vector3(
        result.destination.position_x,
        result.destination.position_y ?? 0,
        result.destination.position_z,
      );
      if (!system.queuedRoutine && options.interrupted) {
        return;
      }
      if (!system.queuedRoutine) {
        system.queuedRoutine = buildRoutine(system, {
          sourceKind: "queued",
          routineType: "solo",
          targetTagId: result.destination.tag_id,
          targetAnchor: anchor,
          focusKey,
          focusResult: result,
        });
      }
      const routine = system.queuedRoutine;
      const focusChanged = routine.focusKey && routine.focusKey !== focusKey;
      routine.requestedActive = true;
      routine.interrupted = Boolean(options.interrupted);
      routine.focusKey = focusKey;
      routine.focusResult = result;
      routine.targetTagId = result.destination.tag_id;
      routine.targetAnchor.copy(anchor);
      if (routine.interrupted) {
        if (routine.phase === "idle" && routine.members.every((actor) => actor.opacity < 0.02)) {
          routine.requestedActive = false;
          routine.phase = "done";
          return;
        }
        if (routine.phase !== "move" || routine.moveReason !== "exit") {
          beginExit(routine);
        }
        return;
      }
      if (focusChanged) {
        routine.loopsRemaining = randomInteger(1, 3);
        routine.thoughtPassIndex = 0;
        beginMove(
          routine,
          {
            id: result.destination.tag_id,
            position: anchor,
          },
          {
            reason: "retarget",
            moveSpeed: 15,
            spawnOutside: routine.members.every((actor) => actor.opacity < 0.02),
            fadeIn: routine.members.every((actor) => actor.opacity < 0.02),
          },
        );
      } else if (routine.phase === "idle") {
        routine.loopsRemaining = randomInteger(1, 3);
      }
    },

    update(deltaSeconds, elapsedSeconds) {
      for (const [type, routine] of [...system.ambientRoutines.entries()]) {
        advanceRoutineState(routine, system, deltaSeconds);
        updateRoutineMotion(routine, deltaSeconds, elapsedSeconds);
        if (routine.phase === "done") {
          for (const actor of routine.members) {
            disposeActor(system, actor);
          }
          system.ambientRoutines.delete(type);
        }
      }

      if (system.queuedRoutine) {
        const queuedMissing =
          system.queuedRoutine.requestedActive
          && (!system.queuedRoutine.targetTagId || !system.queuedRoutine.focusResult?.destination);
        if (queuedMissing && (system.queuedRoutine.phase !== "move" || system.queuedRoutine.moveReason !== "exit")) {
          beginExit(system.queuedRoutine);
        }
        advanceRoutineState(system.queuedRoutine, system, deltaSeconds);
        updateRoutineMotion(system.queuedRoutine, deltaSeconds, elapsedSeconds);
        if (system.queuedRoutine.phase === "done") {
          for (const actor of system.queuedRoutine.members) {
            disposeActor(system, actor);
          }
          system.queuedRoutine = null;
        }
      }
    },

    dispose() {
      for (const routine of system.ambientRoutines.values()) {
        for (const actor of routine.members) {
          disposeActor(system, actor);
        }
      }
      system.ambientRoutines.clear();
      if (system.queuedRoutine) {
        for (const actor of system.queuedRoutine.members) {
          disposeActor(system, actor);
        }
        system.queuedRoutine = null;
      }
    },
  };
}
