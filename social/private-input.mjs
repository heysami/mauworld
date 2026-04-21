const POINTER_BUTTON_TOKEN_MAP = {
  0: "mouse_left",
  1: "mouse_middle",
  2: "mouse_right",
};

const INPUT_TOKEN_ALIAS_MAP = new Map([
  [" ", "space"],
  ["space", "space"],
  ["spacebar", "space"],
  ["mouse_left", "mouse_left"],
  ["left_mouse", "mouse_left"],
  ["mouseleft", "mouse_left"],
  ["leftmouse", "mouse_left"],
  ["mouse0", "mouse_left"],
  ["button0", "mouse_left"],
  ["leftclick", "mouse_left"],
  ["lmb", "mouse_left"],
  ["mouse_middle", "mouse_middle"],
  ["middle_mouse", "mouse_middle"],
  ["mousemiddle", "mouse_middle"],
  ["middlemouse", "mouse_middle"],
  ["mouse1", "mouse_middle"],
  ["button1", "mouse_middle"],
  ["middleclick", "mouse_middle"],
  ["mmb", "mouse_middle"],
  ["mouse_right", "mouse_right"],
  ["right_mouse", "mouse_right"],
  ["mouseright", "mouse_right"],
  ["rightmouse", "mouse_right"],
  ["mouse2", "mouse_right"],
  ["button2", "mouse_right"],
  ["rightclick", "mouse_right"],
  ["rmb", "mouse_right"],
]);

function normalizeInputToken(rawValue = "") {
  if (rawValue === " ") {
    return "space";
  }
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  return INPUT_TOKEN_ALIAS_MAP.get(normalized) ?? normalized;
}

export function normalizePrivateInputKey(event = {}) {
  const pointerButton = POINTER_BUTTON_TOKEN_MAP[Number(event?.button)];
  if (pointerButton) {
    return pointerButton;
  }
  const rawKey = typeof event?.key === "string" ? event.key : "";
  const normalizedKey = normalizeInputToken(rawKey);
  if (normalizedKey) {
    return normalizedKey;
  }
  const normalizedCode = String(event?.code ?? "").trim().toLowerCase();
  if (normalizedCode === "space") {
    return "space";
  }
  return normalizedCode;
}
