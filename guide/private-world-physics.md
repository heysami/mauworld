# Private World Physics Contract

This note is for future agents working on private-world player physics in `social/`.

The current behavior is considered correct. Do not change these rules casually. Most of the bad regressions came from violating the client/server boundary, not from small math mistakes.

## Non-negotiable contract

- Client calculates all occupied-player collision prevention locally.
- Client calculates all standing-on-top-of-solids behavior locally.
- Client calculates all moving-platform carry and transfer locally.
- Server does not re-solve, correct, or "help" those player/platform interactions.
- Server only mirrors the final client-resolved occupied-player pose so other players see what the client decided.

If you move support, grounding, carry, landing, or overlap recovery back onto the server, you will reintroduce snapback, disagreement, and fake platform behavior.

## Current model

For an occupied rigid player in a private world:

1. Local prediction resolves horizontal blockers on the client.
2. Local prediction finds support surfaces under the player on the client.
3. If the player is on a moving platform, the client latches that platform and carries the player with it.
4. If support is lost, the client decides whether the player should stay grounded, become airborne, or land on a new elevated support.
5. The client sends the final resolved pose through presence/runtime updates.
6. The server mirrors that pose to other clients and does not run a second standing/carry solver for the occupied player.

## File map

- `social/private-worlds.js`
  - main possessed-player prediction
  - local jump bridge and landing decisions
  - local grounding / support handoff
  - moving-platform carry latch and carry follow
  - final client-resolved pose sent outward
- `social/private-player-collision.mjs`
  - blocker resolution against solids
  - rotated support sampling
  - support top calculation at the player's actual `x/z`
- `social/private-runtime-motion.mjs`
  - continuous motion helpers for locally resolved runtime motion
  - keep this module version aligned with the collision module import version used by `private-worlds.js`
- `social/private-worlds.html`
  - cache-busted client entrypoint
  - bump the `private-worlds.js?v=...` tag when shipping a client physics fix so production cannot keep serving stale code

## Rules that must stay true

### 1. Support is sampled from the real support surface

Do not use a tilted platform's unrotated box top or loose AABB top as the player's support height.

Support for rotated solids must come from the sampled support surface at the player's current `x/z`.

### 2. Jump landing on elevated support is client-local

When descending from a jump, the client may land on an elevated voxel/platform before returning to its original `groundY`.

But landing should only snap when the player is near real contact, not merely because a valid support exists somewhere below.

### 3. Carry latch is local and explicit

When standing on a moving platform, the client should remember:

- `localCarryPlatformId`
- the platform position used for the latch
- the relative rider offset

That latch should be used to carry the rider each frame.

### 4. Stepping off elevated support must clear elevated fallback

Do not let stale elevated `groundY` keep a player floating after leaving a platform or voxel.

If support is gone, the client must become airborne and then land on the next valid local support.

### 5. The server does not do a second solve

Do not:

- force a server rigid body to re-apply the client pose as physical truth
- run server-side carry logic for an occupied rigid player
- correct occupied-player standing-on-platform on the server
- let the server push the occupied player back onto a platform

The server should relay the resolved client pose, not participate in support/carry math.

## Regressions we already hit

These all caused real breakage and should be treated as known traps:

- server-side carry / standing correction for occupied players
- forcing the server rigid body to the client pose
- sampling tilted support from the wrong top height
- allowing descending jumps to snap onto support too early
- preserving stale elevated `groundY` after the player steps off support
- changing one runtime module without updating the matching client bundle/import version

## What to verify after a physics change

Run at least these checks:

1. Floor -> voxel jump:
   - without touching the moving platform first
   - player lands on top of the voxel
   - snap happens at contact, not early in descent
2. Moving platform:
   - player lands on top of the platform
   - player is carried with it while staying above it
   - observer sees the same final carried pose
3. Step off support:
   - stepping off a platform or voxel makes the player fall to the next valid support
   - no hovering at the previous elevated `groundY`
4. Rotated support:
   - tilted platforms support the player at the sampled top-face height, not a flat-box top

And run:

```bash
node --check social/private-worlds.js
node --test social/private-player-collision.test.mjs social/private-runtime-motion.test.mjs
```

## Safe change strategy

If you need to change private-world physics:

1. Keep the client/server boundary fixed.
2. Change the smallest client-side support/carry/landing path that explains the bug.
3. Verify both rider view and observer view for moving platforms.
4. Verify floor -> voxel directly, not only platform -> voxel.
5. Bump the private-world client cache tag when deploying.

If a proposed fix requires "just a little bit" of server help for occupied-player support or carry, treat that as a design smell and back up.
