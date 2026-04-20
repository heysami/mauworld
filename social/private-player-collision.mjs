function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function halfExtents(size = {}) {
  return {
    x: Math.max(0.05, finite(size.x, 0) / 2),
    y: Math.max(0.05, finite(size.y, 0) / 2),
    z: Math.max(0.05, finite(size.z, 0) / 2),
  };
}

function buildAbsoluteRotationMatrix(rotation = {}) {
  const x = finite(rotation.x, 0);
  const y = finite(rotation.y, 0);
  const z = finite(rotation.z, 0);
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);

  return {
    m11: Math.abs(cy * cz),
    m12: Math.abs(-cy * sz),
    m13: Math.abs(sy),
    m21: Math.abs(sx * sy * cz + cx * sz),
    m22: Math.abs(cx * cz - sx * sy * sz),
    m23: Math.abs(-sx * cy),
    m31: Math.abs(sx * sz - cx * sy * cz),
    m32: Math.abs(sx * cz + cx * sy * sz),
    m33: Math.abs(cx * cy),
  };
}

function rotatedHalfExtents(size = {}, rotation = {}) {
  const half = halfExtents(size);
  const matrix = buildAbsoluteRotationMatrix(rotation);
  return {
    x: matrix.m11 * half.x + matrix.m12 * half.y + matrix.m13 * half.z,
    y: matrix.m21 * half.x + matrix.m22 * half.y + matrix.m23 * half.z,
    z: matrix.m31 * half.x + matrix.m32 * half.y + matrix.m33 * half.z,
  };
}

function overlapsOnAxes(position, half, blocker, axes, epsilon) {
  return axes.every((axis) => (
    Math.abs(finite(position?.[axis], 0) - finite(blocker.position?.[axis], 0))
      < finite(half?.[axis], 0) + finite(blocker.half?.[axis], 0) - epsilon
  ));
}

function chooseBoundaryForOverlap(startValue, targetValue, blockerCenter, minBoundary, maxBoundary, epsilon) {
  const safeStart = finite(startValue, 0);
  const safeTarget = finite(targetValue, safeStart);
  const safeCenter = finite(blockerCenter, 0);
  const delta = safeTarget - safeStart;
  if (safeStart <= safeCenter - epsilon) {
    return minBoundary;
  }
  if (safeStart >= safeCenter + epsilon) {
    return maxBoundary;
  }
  if (delta > epsilon) {
    return maxBoundary;
  }
  if (delta < -epsilon) {
    return minBoundary;
  }
  return Math.abs(safeStart - minBoundary) <= Math.abs(safeStart - maxBoundary)
    ? minBoundary
    : maxBoundary;
}

export function resolvePlayerMovementAgainstBlockers(input = {}) {
  const epsilon = Math.max(0.0001, finite(input.epsilon, 0.0001));
  const startPosition = {
    x: finite(input.startPosition?.x, 0),
    y: finite(input.startPosition?.y, 0),
    z: finite(input.startPosition?.z, 0),
  };
  const desiredPosition = {
    x: finite(input.desiredPosition?.x, startPosition.x),
    y: finite(input.desiredPosition?.y, startPosition.y),
    z: finite(input.desiredPosition?.z, startPosition.z),
  };
  const playerHalf = halfExtents(input.playerSize);
  const blockers = (Array.isArray(input.blockers) ? input.blockers : [])
    .map((blocker) => ({
      position: {
        x: finite(blocker?.position?.x, 0),
        y: finite(blocker?.position?.y, 0),
        z: finite(blocker?.position?.z, 0),
      },
      half: rotatedHalfExtents(blocker?.size ?? {}, blocker?.rotation ?? {}),
    }));

  const resolved = { ...startPosition };
  const blockedAxes = {
    x: false,
    z: false,
  };

  for (const axis of ["x", "z"]) {
    const otherAxis = axis === "x" ? "z" : "x";
    const target = desiredPosition[axis];
    const startValue = resolved[axis];
    let nextValue = target;
    for (const blocker of blockers) {
      const candidatePosition = {
        x: axis === "x" ? startValue : resolved.x,
        y: desiredPosition.y,
        z: axis === "z" ? startValue : resolved.z,
      };
      if (!overlapsOnAxes(candidatePosition, playerHalf, blocker, ["y", otherAxis], epsilon)) {
        continue;
      }
      const combinedHalf = playerHalf[axis] + blocker.half[axis];
      const minBoundary = blocker.position[axis] - combinedHalf - epsilon;
      const maxBoundary = blocker.position[axis] + combinedHalf + epsilon;
      const segmentMin = Math.min(startValue, nextValue);
      const segmentMax = Math.max(startValue, nextValue);
      const overlapsOrCrossesAxis = segmentMax > minBoundary && segmentMin < maxBoundary;
      if (!overlapsOrCrossesAxis) {
        continue;
      }
      const boundary = chooseBoundaryForOverlap(
        startValue,
        nextValue,
        blocker.position[axis],
        minBoundary,
        maxBoundary,
        epsilon,
      );
      blockedAxes[axis] = true;
      nextValue = boundary;
    }

    resolved[axis] = nextValue;
  }

  return {
    position: resolved,
    blockedAxes,
  };
}

export function resolvePlayerGroundSupport(input = {}) {
  const epsilon = Math.max(0.0001, finite(input.epsilon, 0.0001));
  const verticalTolerance = Math.max(epsilon, finite(input.verticalTolerance, 0.24));
  const startPosition = {
    x: finite(input.startPosition?.x, 0),
    y: finite(input.startPosition?.y, 0),
    z: finite(input.startPosition?.z, 0),
  };
  const desiredPosition = {
    x: finite(input.desiredPosition?.x, startPosition.x),
    y: finite(input.desiredPosition?.y, startPosition.y),
    z: finite(input.desiredPosition?.z, startPosition.z),
  };
  const playerHalf = halfExtents(input.playerSize);
  const startBottom = startPosition.y - playerHalf.y;
  const desiredBottom = desiredPosition.y - playerHalf.y;
  const minBottom = Math.min(startBottom, desiredBottom) - verticalTolerance;
  const maxBottom = Math.max(startBottom, desiredBottom) + verticalTolerance;
  const blockers = (Array.isArray(input.blockers) ? input.blockers : [])
    .map((blocker) => ({
      raw: blocker ?? null,
      position: {
        x: finite(blocker?.position?.x, 0),
        y: finite(blocker?.position?.y, 0),
        z: finite(blocker?.position?.z, 0),
      },
      half: rotatedHalfExtents(blocker?.size ?? {}, blocker?.rotation ?? {}),
    }));

  let bestSupport = null;
  for (const blocker of blockers) {
    const combinedHalfX = playerHalf.x + blocker.half.x;
    const combinedHalfZ = playerHalf.z + blocker.half.z;
    if (
      Math.abs(desiredPosition.x - blocker.position.x) > combinedHalfX + epsilon
      || Math.abs(desiredPosition.z - blocker.position.z) > combinedHalfZ + epsilon
    ) {
      continue;
    }
    const topY = blocker.position.y + blocker.half.y;
    if (topY < minBottom || topY > maxBottom) {
      continue;
    }
    const verticalGap = desiredBottom - topY;
    const absoluteGap = Math.abs(verticalGap);
    if (
      !bestSupport
      || topY > bestSupport.surfaceY + epsilon
      || (Math.abs(topY - bestSupport.surfaceY) <= epsilon && absoluteGap < bestSupport.absoluteGap)
    ) {
      bestSupport = {
        blocker: blocker.raw,
        surfaceY: topY,
        groundY: topY + playerHalf.y,
        verticalGap,
        absoluteGap,
      };
    }
  }

  if (!bestSupport) {
    return {
      hasSupport: false,
      blocker: null,
      surfaceY: Number.NaN,
      groundY: Number.NaN,
      verticalGap: Number.NaN,
      absoluteGap: Number.POSITIVE_INFINITY,
    };
  }

  return {
    hasSupport: true,
    blocker: bestSupport.blocker,
    surfaceY: bestSupport.surfaceY,
    groundY: bestSupport.groundY,
    verticalGap: bestSupport.verticalGap,
    absoluteGap: bestSupport.absoluteGap,
  };
}
