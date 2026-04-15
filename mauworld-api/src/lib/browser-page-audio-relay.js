(function installMauworldBrowserAudioRelay() {
  if (window.MauworldBrowserAudioRelay) {
    return;
  }

  const state = {
    room: null,
    audioContext: null,
    destination: null,
    publication: null,
    connectedElements: new WeakSet(),
    mutationObserver: null,
    originalPlay: null,
  };

  function getAudioContextConstructor() {
    return window.AudioContext || window.webkitAudioContext || null;
  }

  function ensureAudioGraph() {
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) {
      throw new Error("This browser does not support Web Audio.");
    }
    if (!state.audioContext) {
      state.audioContext = new AudioContextCtor();
      state.destination = state.audioContext.createMediaStreamDestination();
    }
    return state.audioContext;
  }

  function attachMediaElement(element) {
    if (!(element instanceof HTMLMediaElement) || state.connectedElements.has(element)) {
      return false;
    }
    const audioContext = ensureAudioGraph();
    try {
      const sourceNode = audioContext.createMediaElementSource(element);
      sourceNode.connect(state.destination);
      state.connectedElements.add(element);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function scanMediaElements(root = document) {
    root.querySelectorAll?.("audio,video")?.forEach((element) => {
      attachMediaElement(element);
    });
  }

  function installHooks() {
    if (!state.originalPlay) {
      state.originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function patchedPlay(...args) {
        attachMediaElement(this);
        void state.audioContext?.resume?.().catch(() => null);
        return state.originalPlay.apply(this, args);
      };
    }
    if (!state.mutationObserver) {
      state.mutationObserver = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) {
              continue;
            }
            if (node.matches?.("audio,video")) {
              attachMediaElement(node);
            }
            scanMediaElements(node);
          }
        }
      });
      state.mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
  }

  async function stop() {
    try {
      if (state.publication?.track) {
        await state.room?.localParticipant?.unpublishTrack?.(state.publication.track);
      }
    } catch (_error) {
      // Best effort.
    }
    state.publication = null;
    state.room?.disconnect();
    state.room = null;
  }

  async function start(config) {
    try {
      await stop();
      const liveKit = window.LivekitClient;
      if (!liveKit?.Room || !liveKit?.Track) {
        throw new Error("LiveKit browser client is unavailable in the page context.");
      }
      ensureAudioGraph();
      installHooks();
      scanMediaElements(document);
      await state.audioContext.resume().catch(() => null);

      const audioTrack = state.destination.stream.getAudioTracks()[0];
      if (!audioTrack) {
        throw new Error("Could not create a browser audio track.");
      }

      const room = new liveKit.Room({
        adaptiveStream: true,
        dynacast: true,
      });
      await room.connect(config.serverUrl, config.token, {
        autoSubscribe: false,
      });
      const publication = await room.localParticipant.publishTrack(audioTrack, {
        name: `browser-audio:${config.sessionId}`,
        source: liveKit.Track.Source.ScreenShareAudio ?? liveKit.Track.Source.Unknown,
      });
      state.room = room;
      state.publication = { publication, track: audioTrack };
      return { ok: true };
    } catch (error) {
      await stop();
      return {
        ok: false,
        error: error?.message || "Shared browser audio relay failed.",
      };
    }
  }

  window.MauworldBrowserAudioRelay = {
    start,
    stop,
  };
})();
