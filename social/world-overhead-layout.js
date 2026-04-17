export const SHARED_CHAT_BUBBLE_LAYOUT = Object.freeze({
  anchorY: 15.2,
  baseWidth: 18,
  baseHeight: 12,
  textureMaxWidth: 820,
  textureMaxHeight: 620,
  maxLines: 8,
  minWidth: 6.2,
  minHeight: 4.9,
});

export const SHARED_BROWSER_SHARE_LAYOUT = Object.freeze({
  radius: 96,
  aspectRatio: 16 / 9,
  placeholderAspectRatio: 384 / 280,
  screenWidth: SHARED_CHAT_BUBBLE_LAYOUT.baseWidth * 0.69,
  placeholderAudioWidth: SHARED_CHAT_BUBBLE_LAYOUT.baseWidth * 0.69 * 0.39,
  placeholderVideoWidth: SHARED_CHAT_BUBBLE_LAYOUT.baseWidth * 0.69 * 0.43,
  liveOffsetY: SHARED_CHAT_BUBBLE_LAYOUT.anchorY + 0.4,
  placeholderOffsetY: SHARED_CHAT_BUBBLE_LAYOUT.anchorY - 0.8,
  liveBobFrequency: 1.3,
  liveBobAmplitude: 0.7,
  placeholderBobFrequency: 1.1,
  placeholderBobAmplitude: 0.18,
});

export function getSharedBrowserScreenOffsetY(showingLiveMedia, elapsedSeconds = 0) {
  return showingLiveMedia
    ? SHARED_BROWSER_SHARE_LAYOUT.liveOffsetY
      + Math.sin(elapsedSeconds * SHARED_BROWSER_SHARE_LAYOUT.liveBobFrequency)
        * SHARED_BROWSER_SHARE_LAYOUT.liveBobAmplitude
    : SHARED_BROWSER_SHARE_LAYOUT.placeholderOffsetY
      + Math.sin(elapsedSeconds * SHARED_BROWSER_SHARE_LAYOUT.placeholderBobFrequency)
        * SHARED_BROWSER_SHARE_LAYOUT.placeholderBobAmplitude;
}
