import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";

function stopCapturedStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function getShareFailureMessage(messages, shareKind, fallback) {
  if (messages && typeof messages === "object") {
    return messages[shareKind] || fallback;
  }
  return fallback;
}

export function sanitizeBrowserShareTitle(rawTitle, fallback = "") {
  const cleaned = String(rawTitle ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  return cleaned || fallback;
}

export function normalizeBrowserShareKind(rawKind, fallback = "screen") {
  const value = String(rawKind ?? "").trim().toLowerCase();
  if (value === "screen" || value === "camera" || value === "audio" || value === "browser") {
    return value;
  }
  return fallback;
}

export function getDisplayShareLabel(videoTrack) {
  const settings = videoTrack?.getSettings?.() ?? {};
  const displaySurface = String(settings.displaySurface ?? "").trim().toLowerCase();
  if (displaySurface === "browser") {
    return "Shared tab";
  }
  if (displaySurface === "window") {
    return "Shared window";
  }
  return "Shared screen";
}

export function getDefaultBrowserShareTitle(shareKind, videoTrack = null) {
  const kind = normalizeBrowserShareKind(shareKind, "screen");
  if (kind === "camera") {
    return "Live video";
  }
  if (kind === "audio") {
    return "Live voice";
  }
  return getDisplayShareLabel(videoTrack);
}

export function getBrowserShareKindLabel(shareKind) {
  const kind = normalizeBrowserShareKind(shareKind, "screen");
  if (kind === "camera") {
    return "Video";
  }
  if (kind === "audio") {
    return "Voice";
  }
  if (kind === "browser") {
    return "Browser";
  }
  return "Screen";
}

export function syncShareModeButtons(buttons, mode, attributeName, fallback = "screen") {
  const normalized = normalizeBrowserShareKind(mode, fallback);
  for (const button of buttons ?? []) {
    const active = button?.getAttribute(attributeName) === normalized;
    button?.classList?.toggle("is-active", active);
    button?.setAttribute?.("aria-pressed", active ? "true" : "false");
  }
  return normalized;
}

export function getLocalDisplayShareDraft(options = {}) {
  const draftMode = normalizeBrowserShareKind(options.selectedMode, "screen");
  const draftModeLabel = getBrowserShareKindLabel(draftMode);
  const draftTitle = sanitizeBrowserShareTitle(options.draftTitle ?? "", "");
  const localSession = options.localSession ?? null;
  const getSessionShareKind = typeof options.getSessionShareKind === "function"
    ? options.getSessionShareKind
    : (session) => session?.shareKind || "";
  const liveKind = localSession ? normalizeBrowserShareKind(getSessionShareKind(localSession), "screen") : "";
  const liveKindLabel = localSession ? getBrowserShareKindLabel(liveKind) : "";
  const liveTitle = sanitizeBrowserShareTitle(localSession?.title ?? "", "");
  const isDisplayShare = Boolean(localSession && localSession.sessionMode === "display-share");
  const modeDiff = Boolean(isDisplayShare && draftMode !== liveKind);
  const titleDiff = Boolean(isDisplayShare && draftTitle && draftTitle !== liveTitle);
  return {
    draftMode,
    draftModeLabel,
    draftTitle,
    liveKind,
    liveKindLabel,
    liveTitle,
    modeDiff,
    titleDiff,
    canUpdateTitleOnly: Boolean(isDisplayShare && !modeDiff && titleDiff && options.pending !== true),
  };
}

export function isEmojiOnlyChatText(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return false;
  }
  const compact = trimmed.replace(/\s+/gu, "");
  return /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)+$/u.test(compact);
}

export function createChatComposerController(options = {}) {
  const input = options.input ?? null;

  function afterInputChange() {
    options.onAfterInputChange?.(String(input?.value ?? ""));
  }

  function releaseFocus() {
    if (!input) {
      return;
    }
    input.blur();
    if (document.activeElement !== input) {
      return;
    }
    const retryBlur = () => {
      if (document.activeElement === input) {
        input.blur();
      }
    };
    if (typeof queueMicrotask === "function") {
      queueMicrotask(retryBlur);
    }
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(retryBlur);
      return;
    }
    if (typeof setTimeout === "function") {
      setTimeout(retryBlur, 0);
    }
  }

  function close(clearValue = false, settings = {}) {
    if (!input) {
      return;
    }
    if (clearValue) {
      input.value = "";
    }
    afterInputChange();
    if (settings.keepFocus === true) {
      input.focus();
      return;
    }
    releaseFocus();
  }

  function submit(settings = {}) {
    const text = String(input?.value ?? "").trim();
    if (!text) {
      options.onEmpty?.();
      close(true, { keepFocus: settings.keepFocus === true });
      return false;
    }
    const sent = options.onSubmit?.(text) === true;
    if (!sent) {
      options.onSubmitFailed?.(text);
      return false;
    }
    close(true, { keepFocus: settings.keepFocus === true });
    options.onSubmitted?.(text, { reaction: false });
    return true;
  }

  function sendReaction(reaction, settings = {}) {
    const text = String(reaction ?? "").trim();
    if (!text) {
      return false;
    }
    const sent = options.onSubmit?.(text) === true;
    if (!sent) {
      options.onReactionFailed?.(text);
      return false;
    }
    if (settings.blurInput !== false && document.activeElement === input) {
      input?.blur();
    }
    options.onSubmitted?.(text, { reaction: true });
    return true;
  }

  function handleKeydown(event) {
    if (!event) {
      return false;
    }
    if (event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      event.stopPropagation?.();
      submit({ keepFocus: event.shiftKey === true });
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation?.();
      close(true);
      return true;
    }
    return false;
  }

  return {
    close,
    handleKeydown,
    sendReaction,
    submit,
  };
}

export function createChatFeature(options = {}) {
  const controller = createChatComposerController(options);

  function bind() {
    let suppressNextSubmit = false;
    const clearSubmitSuppression = () => {
      suppressNextSubmit = false;
    };
    options.input?.addEventListener("input", () => {
      options.onAfterInputChange?.(String(options.input?.value ?? ""));
    });
    options.input?.addEventListener("keydown", (event) => {
      const handled = controller.handleKeydown(event);
      if (!handled) {
        return;
      }
      suppressNextSubmit = true;
      if (typeof queueMicrotask === "function") {
        queueMicrotask(clearSubmitSuppression);
        return;
      }
      if (typeof setTimeout === "function") {
        setTimeout(clearSubmitSuppression, 0);
      }
    });
    options.form?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (suppressNextSubmit) {
        suppressNextSubmit = false;
        return;
      }
      controller.submit();
    });
    for (const button of options.reactionButtons ?? []) {
      button.addEventListener("click", () => {
        const reaction =
          button.getAttribute(options.reactionAttribute || "")
          || button.textContent
          || "";
        options.onBeforeReaction?.(reaction, button);
        controller.sendReaction(
          reaction,
        );
      });
    }
  }

  return {
    bind,
    close: controller.close,
    handleKeydown: controller.handleKeydown,
    sendReaction: controller.sendReaction,
    submit: controller.submit,
  };
}

export function createChatBubbleRenderer(options = {}) {
  const clampSize = typeof options.clampSize === "function"
    ? options.clampSize
    : (value, fallback, min, max) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          return fallback;
        }
        return Math.max(min, Math.min(max, numeric));
      };

  function removeGhost(entry) {
    const ghostState = options.getGhostState?.() ?? null;
    const entries = ghostState?.entries ?? null;
    if (!entry?.mesh) {
      return;
    }
    options.beforeRemoveGhost?.(entry.mesh);
    if (entry.mesh.parent) {
      entry.mesh.parent.remove(entry.mesh);
    }
    entry.mesh.geometry?.dispose?.();
    if (typeof options.disposeMaterial === "function") {
      options.disposeMaterial(entry.mesh.material);
    } else {
      entry.mesh.material?.map?.dispose?.();
      entry.mesh.material?.dispose?.();
    }
    if (!entries) {
      return;
    }
    const index = entries.indexOf(entry);
    if (index >= 0) {
      entries.splice(index, 1);
    }
  }

  function spawnGhost(actorEntry, texture) {
    const ghostState = options.getGhostState?.() ?? null;
    if (!ghostState?.root || !ghostState?.entries || !actorEntry?.bubble?.mesh || !texture || actorEntry.bubble.opacity <= 0.01) {
      texture?.dispose?.();
      return;
    }
    actorEntry.bubble.mesh.updateWorldMatrix(true, false);
    const worldPosition = new THREE.Vector3();
    const worldScale = new THREE.Vector3();
    actorEntry.bubble.mesh.getWorldPosition(worldPosition);
    actorEntry.bubble.mesh.getWorldScale(worldScale);
    const baseWidth = Number(actorEntry.bubble.baseWidth) || Number(options.baseWidth) || 14.2;
    const baseHeight = Number(actorEntry.bubble.baseHeight) || Number(options.baseHeight) || 9.2;
    const mesh = options.createBillboard?.(texture, baseWidth, baseHeight, {
      opacity: actorEntry.bubble.mesh.material.opacity,
      fog: false,
      depthTest: false,
      renderOrder: Number(options.ghostRenderOrder) || 10.5,
    });
    if (!mesh) {
      texture?.dispose?.();
      return;
    }
    const initialOffset = new THREE.Vector3(
      (Math.random() - 0.5) * Math.max(0.8, baseWidth * 0.08),
      Math.max(1.1, baseHeight * 0.16),
      (Math.random() - 0.5) * Math.max(0.22, baseWidth * 0.024),
    );
    mesh.position.copy(worldPosition);
    mesh.position.add(initialOffset);
    mesh.scale.copy(worldScale);
    ghostState.root.add(mesh);
    ghostState.entries.push({
      mesh,
      opacity: Math.max(actorEntry.bubble.mesh.material.opacity, 0.55),
      lifetime: 1.55 + Math.random() * 0.35,
      age: 0,
      drift: new THREE.Vector3(
        initialOffset.x * 0.34,
        3 + Math.random() * 0.9,
        initialOffset.z * 0.36,
      ),
      scaleBase: worldScale.clone(),
    });
  }

  function getTargetSize(texture, bubble) {
    const baseWidth = Number(bubble?.baseWidth) || Number(options.baseWidth) || 14.2;
    const baseHeight = Number(bubble?.baseHeight) || Number(options.baseHeight) || 9.2;
    const layout = texture?.userData?.bubbleLayout ?? null;
    if (!layout?.hasText) {
      return { width: baseWidth, height: baseHeight };
    }
    const maxTextureWidth = Math.max(
      1,
      Number(layout.maxWidth) || Number(layout.width) || Number(options.maxTextureWidth) || 820,
    );
    const maxTextureHeight = Math.max(
      1,
      Number(layout.maxHeight) || Number(layout.height) || Number(options.maxTextureHeight) || 620,
    );
    return {
      width: clampSize(
        baseWidth * ((Number(layout.width) || maxTextureWidth) / maxTextureWidth),
        baseWidth,
        Number(options.minWidth) || 6.2,
        baseWidth,
      ),
      height: clampSize(
        baseHeight * ((Number(layout.height) || maxTextureHeight) / maxTextureHeight),
        baseHeight,
        Number(options.minHeight) || 4.9,
        baseHeight,
      ),
    };
  }

  function apply(actorEntry, chatEvent) {
    if (!actorEntry?.bubble) {
      return;
    }
    if (!chatEvent || Date.parse(chatEvent.expiresAt ?? 0) <= Date.now()) {
      actorEntry.bubble.targetOpacity = 0;
      return;
    }
    const accent = actorEntry.bubbleAccent
      ?? (typeof options.getDefaultAccent === "function" ? options.getDefaultAccent() : options.defaultAccent)
      ?? "#ffffff";
    const text = String(chatEvent.text ?? "").trim();
    const emojiOnly = chatEvent.mode !== "placeholder" && options.isEmojiOnly?.(text) === true;
    const symbol = chatEvent.mode === "placeholder" ? "..." : emojiOnly ? text : "💬";
    const bubbleText = emojiOnly ? "" : text;
    const bubbleKey = `${chatEvent.mode}:${text}:${accent}`;
    if (actorEntry.bubble.currentKey !== bubbleKey) {
      const previousKey = actorEntry.bubble.currentKey;
      const previousMap = actorEntry.bubble.mesh.material.map;
      const nextTexture = options.createTexture?.(symbol, {
        accent,
        stroke: options.stroke,
        text: bubbleText,
        width: bubbleText ? options.maxTextureWidth : undefined,
        height: bubbleText ? options.maxTextureHeight : undefined,
        maxLines: bubbleText ? options.maxLines : undefined,
      });
      actorEntry.bubble.mesh.material.map = nextTexture;
      actorEntry.bubble.mesh.material.needsUpdate = true;
      const nextSize = getTargetSize(nextTexture, actorEntry.bubble);
      actorEntry.bubble.targetWidth = nextSize.width;
      actorEntry.bubble.targetHeight = nextSize.height;
      if (previousMap) {
        if (previousKey && !previousKey.startsWith("placeholder:")) {
          spawnGhost(actorEntry, previousMap);
        } else {
          previousMap.dispose?.();
        }
      }
      actorEntry.bubble.currentKey = bubbleKey;
    }
    actorEntry.bubble.mesh.visible = true;
    actorEntry.bubble.targetOpacity = 1;
    actorEntry.bubble.duration = Math.max(0.5, (Date.parse(chatEvent.expiresAt) - Date.now()) / 1000);
    actorEntry.bubble.elapsed = 0;
    actorEntry.bubble.highEnergy = chatEvent.mode !== "placeholder";
    actorEntry.bubble.bounceCount = actorEntry.bubble.highEnergy ? 2 : 0;
  }

  function update(actorEntry, deltaSeconds, context = {}) {
    if (!actorEntry?.bubble?.mesh) {
      return;
    }
    actorEntry.bubble.width += (actorEntry.bubble.targetWidth - actorEntry.bubble.width) * (1 - Math.exp(-deltaSeconds * 12));
    actorEntry.bubble.height += (actorEntry.bubble.targetHeight - actorEntry.bubble.height) * (1 - Math.exp(-deltaSeconds * 12));
    actorEntry.bubble.opacity += (actorEntry.bubble.targetOpacity - actorEntry.bubble.opacity) * (1 - Math.exp(-deltaSeconds * 10));
    if (Math.abs(actorEntry.bubble.opacity - actorEntry.bubble.targetOpacity) < 0.004) {
      actorEntry.bubble.opacity = actorEntry.bubble.targetOpacity;
    }
    if (actorEntry.bubble.targetOpacity > 0) {
      actorEntry.bubble.elapsed += deltaSeconds;
      if (actorEntry.bubble.elapsed >= actorEntry.bubble.duration) {
        actorEntry.bubble.targetOpacity = 0;
      }
    }
    const bounce =
      actorEntry.bubble.highEnergy && actorEntry.bubble.duration > 0
        ? Math.abs(Math.sin((actorEntry.bubble.elapsed / actorEntry.bubble.duration) * Math.PI * actorEntry.bubble.bounceCount)) * 0.9
        : 0;
    actorEntry.bubble.mesh.visible = actorEntry.bubble.opacity > 0.01 && actorEntry.group.visible !== false;
    actorEntry.bubble.mesh.position.y = actorEntry.bubble.anchorY + bounce;
    const pulse = 0.92 + actorEntry.bubble.opacity * 0.08;
    actorEntry.bubble.mesh.scale.set(
      (actorEntry.bubble.width / actorEntry.bubble.baseWidth) * pulse,
      (actorEntry.bubble.height / actorEntry.bubble.baseHeight) * pulse,
      1,
    );
    actorEntry.bubble.mesh.material.opacity = actorEntry.bubble.opacity * (actorEntry.opacity ?? 1);
    options.orientToCamera?.(actorEntry.bubble.mesh, context.camera ?? null);
  }

  return {
    apply,
    removeGhost,
    update,
  };
}

export function createChatBubbleState(options = {}) {
  const baseWidth = Number(options.baseWidth) || 18;
  const baseHeight = Number(options.baseHeight) || 12;
  const anchorY = Number(options.anchorY ?? 15.2) || 15.2;
  const mesh = options.createBillboard?.(
    options.createTexture?.(options.symbol || "💬", {
      accent: options.accent,
      stroke: options.stroke,
      text: "",
    }),
    baseWidth,
    baseHeight,
    {
      opacity: 0,
      fog: false,
      depthTest: false,
      renderOrder: 11,
      persistent: options.persistent === true,
    },
  );
  if (mesh) {
    mesh.visible = false;
    mesh.position.set(0, anchorY, 0);
  }
  return {
    mesh,
    currentKey: "",
    opacity: 0,
    targetOpacity: 0,
    duration: 0,
    elapsed: 0,
    highEnergy: false,
    bounceCount: 0,
    anchorY,
    baseWidth,
    baseHeight,
    width: baseWidth,
    height: baseHeight,
    targetWidth: baseWidth,
    targetHeight: baseHeight,
  };
}

export function updateChatBubbleGhosts(options = {}) {
  const entries = options.entries ?? null;
  if (!entries?.length) {
    return;
  }
  const deltaSeconds = Math.max(0, Number(options.deltaSeconds) || 0);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    entry.age += deltaSeconds;
    const rawLife = entry.lifetime > 0 ? entry.age / entry.lifetime : 1;
    const life = Math.max(0, Math.min(1, Number.isFinite(rawLife) ? rawLife : 1));
    entry.mesh.position.addScaledVector(entry.drift, deltaSeconds);
    entry.mesh.scale.copy(entry.scaleBase).multiplyScalar(1 + life * 0.18);
    entry.mesh.material.opacity = entry.opacity * Math.pow(1 - life, 0.95);
    options.orientToCamera?.(entry.mesh, options.camera ?? null);
    if (life >= 1) {
      options.removeGhost?.(entry);
    }
  }
}

export function createLocalDisplayShare(stream, options = {}) {
  const videoTrack = stream?.getVideoTracks?.()[0] ?? null;
  const audioTrack = stream?.getAudioTracks?.()[0] ?? null;
  const shareKind = normalizeBrowserShareKind(options.shareKind, "screen");
  const settings = videoTrack?.getSettings?.() ?? {};
  const fallbackWidth = Math.max(1, Math.floor(Number(options.fallbackWidth) || 16));
  const fallbackHeight = Math.max(1, Math.floor(Number(options.fallbackHeight) || 9));
  const width = Math.max(1, Math.floor(Number(settings.width) || fallbackWidth));
  const height = Math.max(1, Math.floor(Number(settings.height) || fallbackHeight));
  const share = {
    stream,
    videoTrack,
    audioTrack,
    observedTrack: videoTrack ?? audioTrack ?? null,
    shareKind,
    title: sanitizeBrowserShareTitle(options.title, getDefaultBrowserShareTitle(shareKind, videoTrack)),
    displaySurface: String(options.displaySurface ?? settings.displaySurface ?? "").trim().toLowerCase(),
    aspectRatio: Number(options.aspectRatio) > 0
      ? Number(options.aspectRatio)
      : width / Math.max(1, height),
    hasVideo: options.hasVideo === true || (options.hasVideo !== false && Boolean(videoTrack)),
    hasAudio: options.hasAudio === true || (options.hasAudio !== false && Boolean(audioTrack)),
    endedHandler: null,
  };
  share.endedHandler = () => {
    if (options.isPendingShare?.(share) === true) {
      options.onEndedWhilePending?.(share);
      return;
    }
    if (options.isLocalShare?.(share) !== true) {
      return;
    }
    options.onEndedWhileLive?.(share);
  };
  share.observedTrack?.addEventListener?.("ended", share.endedHandler, { once: true });
  return share;
}

export function getDisplayShareLaunchState(options = {}) {
  const canShare = options.canShare !== false;
  const pending = options.pending === true;
  const localSession = options.localSession ?? null;
  const draft = options.draft ?? null;
  if (!canShare) {
    return {
      disabled: true,
      label: options.disabledLabel || "Share",
    };
  }
  if (pending) {
    return {
      disabled: true,
      label: "Starting...",
    };
  }
  if (localSession?.sessionMode === "display-share" && draft?.canUpdateTitleOnly) {
    return {
      disabled: false,
      label: "Update Title",
    };
  }
  if (localSession?.sessionMode === "display-share" && draft?.modeDiff) {
    return {
      disabled: false,
      label: `Switch to ${draft.draftModeLabel}`,
    };
  }
  if (localSession?.sessionMode === "display-share") {
    return {
      disabled: false,
      label: "Share Again",
    };
  }
  return {
    disabled: false,
    label: "Share",
  };
}

export function getLocalDisplaySharePresentation(options = {}) {
  const localSession = options.localSession ?? null;
  const localShare = options.localShare ?? null;
  const draft = options.draft ?? null;
  if (!localSession || localSession.sessionMode !== "display-share" || !draft) {
    return null;
  }

  const liveKind = draft.liveKind || normalizeBrowserShareKind(localSession.shareKind, "screen");
  const liveKindLabel = draft.liveKindLabel || getBrowserShareKindLabel(liveKind);
  const audienceLabel = options.audienceLabel || "nearby visitors";
  const screenPrompt = options.screenPrompt || "Share a tab or window to start the nearby stream.";

  let status = "";
  if (localShare?.sessionId === localSession.sessionId) {
    if (liveKind === "audio") {
      status = `Sharing ${localSession.title || "live voice"} with ${audienceLabel}.`;
    } else if (liveKind === "camera") {
      const audioLabel = localShare?.hasAudio ? " with voice" : "";
      status = `Sharing ${localSession.title || "live video"}${audioLabel} with ${audienceLabel}.`;
    } else {
      const audioLabel = localShare?.hasAudio ? " with sound" : "";
      status = `Sharing ${localSession.title || "screen"}${audioLabel} with ${audienceLabel}.`;
    }
  } else if (liveKind === "camera") {
    status = "Allow camera and microphone access to go live.";
  } else if (liveKind === "audio") {
    status = "Allow microphone access to go live.";
  } else {
    status = screenPrompt;
  }

  let hint = options.defaultHint || "Change the type, then press Share again to replace the live share.";
  let summaryState = "live";
  if (draft.canUpdateTitleOnly) {
    hint = `Press Update Title to rename the live ${liveKindLabel.toLowerCase()} to "${draft.draftTitle}".`;
    summaryState = "draft";
  } else if (draft.modeDiff) {
    hint = draft.draftTitle
      ? `Press Switch to replace the live ${liveKindLabel.toLowerCase()} with ${draft.draftModeLabel.toLowerCase()} "${draft.draftTitle}".`
      : `Press Switch to replace the live ${liveKindLabel.toLowerCase()} with ${draft.draftModeLabel.toLowerCase()}.`;
    summaryState = "draft";
  } else if (draft.titleDiff) {
    hint = `Press Update Title to rename the live ${liveKindLabel.toLowerCase()} to "${draft.draftTitle}".`;
    summaryState = "draft";
  } else if (!draft.draftTitle) {
    hint = "The title field is only a draft until you press Share or Update Title.";
  }

  return {
    badge: summaryState === "draft" ? "Draft" : "Live",
    current: `${liveKindLabel} live${draft.liveTitle ? ` - ${draft.liveTitle}` : ""}`,
    hint,
    state: summaryState,
    status,
  };
}

function resolveStageCopy(copy, session) {
  if (typeof copy === "function") {
    return String(copy(session) ?? "");
  }
  return String(copy ?? "");
}

export function getDisplayShareStageLayout(options = {}) {
  const overlayOpen = options.overlayOpen === true;
  const needsManualPlaybackStart = options.needsManualPlaybackStart === true;
  const needsManualAudioStart = options.needsManualAudioStart === true;
  const needsPermissionAction = needsManualPlaybackStart || needsManualAudioStart;
  return {
    needsPermissionAction,
    collapseDockedStage: !overlayOpen && !needsPermissionAction,
    permissionOnlyDockedStage: !overlayOpen && needsPermissionAction,
    needsManualPlaybackStart,
    needsManualAudioStart,
  };
}

export function getDisplayShareStagePlaceholderText(options = {}) {
  const localSession = options.localSession ?? null;
  const remoteSession = options.remoteSession ?? null;
  const session = localSession ?? remoteSession ?? null;
  const needsManualPlaybackStart = options.needsManualPlaybackStart === true;
  const needsManualAudioStart = options.needsManualAudioStart === true;
  const getSessionShareKind = typeof options.getSessionShareKind === "function"
    ? options.getSessionShareKind
    : (entry) => normalizeBrowserShareKind(
      entry?.shareKind,
      entry?.sessionMode === "remote-browser" ? "browser" : "screen",
    );
  const strings = options.strings ?? {};
  const shareKind = getSessionShareKind(session);
  const defaults = {
    idle: "Share a screen, video, or voice nearby.",
    blockedAutoplay: "Browser blocked autoplay. Press start to watch this nearby stream.",
    enableAudioVoice: "Press enable sound to hear this nearby voice stream.",
    enableAudioDefault: "Press enable sound to hear this nearby stream.",
    localAudio: "Voice-only share is live nearby.",
    remoteAudio: (entry) => `Listening to ${entry?.title || "live voice"} nearby.`,
    localCamera: "Video share is live nearby.",
    remoteCamera: (entry) => `Watching ${entry?.title || "live video"} nearby.`,
    localDisplay: "Choose a tab or window in the picker to start sharing.",
    remoteDisplay: (entry) => `Watching ${entry?.title || "nearby share"} nearby.`,
    localBrowser: "This browser session is live nearby.",
    remoteBrowser: (entry) => `Viewing ${entry?.title || "nearby share"} nearby.`,
  };

  if (needsManualPlaybackStart) {
    return resolveStageCopy(strings.blockedAutoplay ?? defaults.blockedAutoplay, session);
  }
  if (needsManualAudioStart) {
    return shareKind === "audio"
      ? resolveStageCopy(strings.enableAudioVoice ?? defaults.enableAudioVoice, session)
      : resolveStageCopy(strings.enableAudioDefault ?? defaults.enableAudioDefault, session);
  }
  if (!session) {
    return resolveStageCopy(strings.idle ?? defaults.idle, null);
  }
  const isLocal = Boolean(localSession);
  if (shareKind === "audio") {
    return isLocal
      ? resolveStageCopy(strings.localAudio ?? defaults.localAudio, session)
      : resolveStageCopy(strings.remoteAudio ?? defaults.remoteAudio, session);
  }
  if (shareKind === "camera") {
    return isLocal
      ? resolveStageCopy(strings.localCamera ?? defaults.localCamera, session)
      : resolveStageCopy(strings.remoteCamera ?? defaults.remoteCamera, session);
  }
  if (session.sessionMode === "display-share") {
    return isLocal
      ? resolveStageCopy(strings.localDisplay ?? defaults.localDisplay, session)
      : resolveStageCopy(strings.remoteDisplay ?? defaults.remoteDisplay, session);
  }
  return isLocal
    ? resolveStageCopy(strings.localBrowser ?? defaults.localBrowser, session)
    : resolveStageCopy(strings.remoteBrowser ?? defaults.remoteBrowser, session);
}

export function createNearbyDisplayShareFeature(options = {}) {
  function getSelectedMode() {
    return normalizeBrowserShareKind(options.getMode?.(), "screen");
  }

  function setSelectedMode(mode) {
    const nextMode = syncShareModeButtons(
      options.modeButtons,
      mode,
      options.modeAttribute || "data-share-mode",
      "screen",
    );
    options.setMode?.(nextMode);
    return nextMode;
  }

  function getRequestedTitle(fallback = "") {
    return sanitizeBrowserShareTitle(options.getTitleInputValue?.() ?? "", fallback);
  }

  function getDraft(localSession = options.getLocalSession?.()) {
    return getLocalDisplayShareDraft({
      selectedMode: getSelectedMode(),
      draftTitle: options.getTitleInputValue?.() ?? "",
      localSession,
      getSessionShareKind: options.getSessionShareKind,
      pending: Boolean(options.getPendingShare?.()),
    });
  }

  function createLocalShare(stream, shareOptions = {}) {
    const shareKind = normalizeBrowserShareKind(shareOptions.shareKind, "screen");
    const fallbackSize = options.getFallbackSize?.(shareKind) ?? { width: 16, height: 9 };
    return createLocalDisplayShare(stream, {
      ...shareOptions,
      fallbackWidth: fallbackSize.width,
      fallbackHeight: fallbackSize.height,
      isPendingShare: (share) => options.getPendingShare?.()?.stream === share.stream,
      isLocalShare: (share) => options.getLocalShare?.()?.stream === share.stream,
      onEndedWhilePending() {
        options.clearPendingShare?.({ stopTracks: false });
        options.updateView?.();
      },
      onEndedWhileLive() {
        const sessionId = String(options.getLocalShare?.()?.sessionId ?? "").trim();
        options.clearLocalShare?.({ stopTracks: false, sessionId });
        if (sessionId) {
          options.stopLiveShare?.(sessionId);
        }
        options.updateView?.();
      },
    });
  }

  function updateLiveTitle(localSession = options.getLocalSession?.()) {
    if (!localSession || localSession.sessionMode !== "display-share") {
      return false;
    }
    const draft = getDraft(localSession);
    if (!draft.canUpdateTitleOnly) {
      return false;
    }
    const sent = options.startLiveShare?.({
      mode: "display-share",
      title: draft.draftTitle,
      shareKind: draft.liveKind,
      hasVideo: localSession.hasVideo !== false,
      hasAudio: localSession.hasAudio === true,
      aspectRatio: localSession.aspectRatio,
      displaySurface: options.getDisplaySurface?.() || "",
    });
    if (!sent) {
      return false;
    }
    options.patchSession?.(localSession.sessionId, {
      ...localSession,
      title: draft.draftTitle,
    });
    options.setStatus?.(options.updatingStatusText || "Updating live share title...");
    options.updateView?.();
    return true;
  }

  async function launch() {
    if (options.canLaunch?.() === false) {
      options.onCannotLaunch?.();
      return false;
    }
    if (updateLiveTitle()) {
      return true;
    }
    return launchNearbyDisplayShare({
      shareKind: getSelectedMode(),
      getRequestedTitle,
      createShare: (stream, shareOptions) => createLocalShare(stream, shareOptions),
      startShare: options.beginShare,
      onUnsupported: options.onUnsupported,
      onError: options.onError,
      unsupportedMessages: options.unsupportedMessages,
      failureMessages: options.failureMessages,
      mediaDevices: options.mediaDevices,
    });
  }

  function bind() {
    options.titleInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      void launch();
    });
    for (const button of options.modeButtons ?? []) {
      button.addEventListener("click", () => {
        const mode = button.getAttribute(options.modeAttribute || "data-share-mode") || "screen";
        setSelectedMode(mode);
        options.onModeChanged?.();
      });
    }
    options.launchButton?.addEventListener("click", () => {
      void launch();
    });
  }

  return {
    bind,
    createLocalShare,
    getDraft,
    getRequestedTitle,
    getSelectedMode,
    launch,
    setSelectedMode,
    updateLiveTitle,
  };
}

export async function launchNearbyDisplayShare(options = {}) {
  const shareKind = normalizeBrowserShareKind(options.shareKind, "screen");
  const mediaDevices = options.mediaDevices ?? navigator.mediaDevices;
  const unsupportedMessages = options.unsupportedMessages ?? {};
  const failureMessages = options.failureMessages ?? {};

  let stream = null;
  try {
    if (shareKind === "camera") {
      if (!mediaDevices?.getUserMedia) {
        options.onUnsupported?.(
          getShareFailureMessage(unsupportedMessages, "camera", "This browser does not support camera sharing."),
        );
        return false;
      }
      stream = await mediaDevices.getUserMedia({
        video: {
          frameRate: { ideal: 24, max: 30 },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          facingMode: "user",
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } else if (shareKind === "audio") {
      if (!mediaDevices?.getUserMedia) {
        options.onUnsupported?.(
          getShareFailureMessage(unsupportedMessages, "audio", "This browser does not support voice sharing."),
        );
        return false;
      }
      stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } else {
      if (!mediaDevices?.getDisplayMedia) {
        options.onUnsupported?.(
          getShareFailureMessage(unsupportedMessages, "screen", "This browser does not support screen sharing."),
        );
        return false;
      }
      stream = await mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 24, max: 30 },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
        },
        audio: true,
      });
    }

    const videoTrack = stream?.getVideoTracks?.()[0] ?? null;
    const titleFallback = getDefaultBrowserShareTitle(shareKind, videoTrack);
    const title = typeof options.getRequestedTitle === "function"
      ? options.getRequestedTitle(titleFallback)
      : sanitizeBrowserShareTitle(options.title ?? "", titleFallback);
    const share = options.createShare?.(stream, {
      shareKind,
      title,
      hasVideo: shareKind === "audio" ? false : undefined,
      hasAudio: shareKind === "audio" ? true : undefined,
      aspectRatio: shareKind === "audio" ? 1.2 : undefined,
    });
    if (!share) {
      stopCapturedStream(stream);
      return false;
    }
    return await options.startShare?.(share);
  } catch (error) {
    if (stream) {
      stopCapturedStream(stream);
    }
    if (error?.name !== "AbortError" && error?.name !== "NotAllowedError") {
      options.onError?.(
        getShareFailureMessage(
          failureMessages,
          shareKind,
          shareKind === "camera"
            ? "Could not start video sharing."
            : shareKind === "audio"
              ? "Could not start voice sharing."
              : "Could not start screen sharing.",
        ),
        error,
      );
    }
    return false;
  }
}
