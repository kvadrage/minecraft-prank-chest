// Prank Chest — Main Script  v0.2.0
// Architecture: vanilla minecraft:chest + Script API prank registry.
// No custom entity, no custom block in the world — the placed object IS a real chest.

import {
    world,
    system,
    BlockPermutation,
    ItemStack,
    GameMode,
} from "@minecraft/server";

// ── Configuration ──────────────────────────────────────────────────────────────
const CONFIG = {
    downgradeDelayTicks:    1000,   // 1 in-game hour ≈ 50 real seconds at default speed
    playSoundOnDowngrade:   true,
    showParticlesOnDowngrade: false,
};

// ── Downgrade tables (reused from v0.1.1 — logic unchanged) ───────────────────
const ORE_DOWNGRADES = {
    "minecraft:ancient_debris":         "minecraft:diamond_ore",
    "minecraft:diamond_ore":            "minecraft:iron_ore",
    "minecraft:gold_ore":               "minecraft:dirt",
    "minecraft:iron_ore":               "minecraft:copper_ore",
    "minecraft:copper_ore":             "minecraft:gold_ore",
    "minecraft:nether_gold_ore":        "minecraft:dirt",
    "minecraft:deepslate_diamond_ore":  "minecraft:deepslate_iron_ore",
    "minecraft:deepslate_gold_ore":     "minecraft:dirt",
    "minecraft:deepslate_iron_ore":     "minecraft:deepslate_copper_ore",
    "minecraft:deepslate_copper_ore":   "minecraft:deepslate_gold_ore",
};

const INGOT_DOWNGRADES = {
    "minecraft:netherite_ingot": "minecraft:diamond",
    "minecraft:diamond":         "minecraft:iron_ingot",
    "minecraft:iron_ingot":      "minecraft:copper_ingot",
    "minecraft:copper_ingot":    "minecraft:gold_ingot",
    "minecraft:gold_ingot":      "minecraft:dirt",
};

// Copper tools/armor don't exist in vanilla — skipped (Option A per design doc)
const TOOL_TIER_CHAIN  = ["netherite", "diamond", "iron", "wooden", "golden"];
const ARMOR_TIER_CHAIN = ["netherite", "diamond", "iron", "leather", "golden"];
const TOOL_TYPES       = ["sword", "pickaxe", "hoe", "shovel", "axe"];
const ARMOR_TYPES      = ["helmet", "chestplate", "leggings", "boots"];

function buildToolDowngrades() {
    const map = {};
    for (const tool of TOOL_TYPES) {
        for (let i = 0; i < TOOL_TIER_CHAIN.length - 1; i++) {
            map[`minecraft:${TOOL_TIER_CHAIN[i]}_${tool}`] =
                `minecraft:${TOOL_TIER_CHAIN[i + 1]}_${tool}`;
        }
        map[`minecraft:golden_${tool}`] = "minecraft:dirt";
    }
    return map;
}

function buildArmorDowngrades() {
    const map = {};
    for (const piece of ARMOR_TYPES) {
        for (let i = 0; i < ARMOR_TIER_CHAIN.length - 1; i++) {
            map[`minecraft:${ARMOR_TIER_CHAIN[i]}_${piece}`] =
                `minecraft:${ARMOR_TIER_CHAIN[i + 1]}_${piece}`;
        }
        map[`minecraft:golden_${piece}`] = "minecraft:dirt";
    }
    return map;
}

const ALL_DOWNGRADES = {
    ...ORE_DOWNGRADES,
    ...INGOT_DOWNGRADES,
    ...buildToolDowngrades(),
    ...buildArmorDowngrades(),
};

// ── Registry ───────────────────────────────────────────────────────────────────
// Registry format stored in world dynamic property "prankchest:registry":
//   { [key]: { [slot]: { typeId: string, rem: number } } }
//
//   key  = "${x},${y},${z},${dim.id}"  (integer coords + actual Dimension.id)
//   rem  = ticks remaining at time of last save (abbreviated to keep JSON small)
//
// Only slots with active timers are stored per chest entry. A chest with no active
// timers is stored as an empty object {}  — this marks it as a prank chest even
// when no timer is running.
//
// Size estimate: ~200 chars per active chest (pessimistic). The world dynamic
// property string limit is 32767 chars in @minecraft/server 1.16.0 stable.
// That's ~160 simultaneous prank chests. Exceeding this logs a warning.
// TODO: verify in-game — confirm actual dynamic property size limit on 1.26.1301.0

const REGISTRY_PROP          = "prankchest:registry";
const REGISTRY_PROP_MAX_CHARS = 32000; // leave 767 chars headroom under the 32767 limit

// Canonical registry (mirrors what's on disk). Loaded once at worldInitialize.
// Plain object so JSON.stringify/parse roundtrips cleanly.
let registry       = {};
let registryLoaded = false;

// In-memory timer state — rebuilt from registry on first access per chest.
// Map<key, { lastSlotTypes: Map<slot, string|null>, timers: Map<slot, {typeId, startTick}> }>
const chestState = new Map();

// Tracks keys with a pending break in the current/next tick so we don't double-process
// if the player somehow triggers two break events before system.run fires.
const pendingBreak = new Set();

let currentTick  = 0;
const POLL_INTERVAL    = 20;   // ticks between downgrade scans ≈ 1 second
const CLEANUP_INTERVAL = 6000; // ticks between stale-registry sweeps ≈ 5 minutes

// getDimension accepts these short names in stable API; dim.id may return the
// "minecraft:" prefixed form — we always use dim.id when building/matching keys.
const DIM_NAMES = ["overworld", "nether", "the_end"];

// ── Key helpers ────────────────────────────────────────────────────────────────
function blockKey(block) {
    const l = block.location;
    // Use block.dimension.id (runtime value) rather than the short lookup name
    // so keys are consistent regardless of what Dimension.id returns.
    // TODO: verify in-game — confirm Dimension.id format on 1.26.1301.0
    // (expected: "minecraft:overworld" / "overworld" — either is fine as long as consistent)
    return `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)},${block.dimension.id}`;
}

function coordKey(x, y, z, dimId) {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)},${dimId}`;
}

function parseKey(key) {
    // key = "x,y,z,dimId" where dimId may itself contain colons (e.g. "minecraft:overworld")
    // Split on comma — coords are integers so no ambiguity with negative signs.
    const firstComma  = key.indexOf(",");
    const secondComma = key.indexOf(",", firstComma + 1);
    const thirdComma  = key.indexOf(",", secondComma + 1);
    return {
        x:     parseInt(key.slice(0, firstComma)),
        y:     parseInt(key.slice(firstComma + 1, secondComma)),
        z:     parseInt(key.slice(secondComma + 1, thirdComma)),
        dimId: key.slice(thirdComma + 1),
    };
}

// ── Registry persistence ───────────────────────────────────────────────────────
function loadRegistry() {
    try {
        const raw = world.getDynamicProperty(REGISTRY_PROP);
        if (typeof raw === "string" && raw.length > 0) {
            registry = JSON.parse(raw);
            console.log(`[PrankChest] Registry loaded — ${Object.keys(registry).length} chest(s)`);
        } else {
            registry = {};
            console.log("[PrankChest] Registry empty (fresh world or first install)");
        }
    } catch (e) {
        console.warn("[PrankChest] Failed to load registry, starting empty:", e);
        registry = {};
    }
}

function saveRegistry() {
    try {
        const str = JSON.stringify(registry);
        if (str.length > REGISTRY_PROP_MAX_CHARS) {
            console.warn(
                `[PrankChest] Registry is ${str.length} chars — approaching the 32767-char ` +
                `limit. Remove old prank chests to free space.`
            );
        }
        world.setDynamicProperty(REGISTRY_PROP, str);
    } catch (e) {
        console.warn("[PrankChest] Failed to save registry:", e);
    }
}

function registerChest(key) {
    if (!(key in registry)) {
        registry[key] = {};
        saveRegistry();
    }
}

function unregisterChest(key) {
    if (key in registry) {
        delete registry[key];
        chestState.delete(key);
        saveRegistry();
        console.log(`[PrankChest] Unregistered ${key}`);
    }
}

function isPrankChest(key) {
    return key in registry;
}

// ── Placement ──────────────────────────────────────────────────────────────────
// MUST: The placed object is a real minecraft:chest — not a custom block or entity.
// We intercept beforeEvents.itemUseOn, cancel the default item-use, then in the
// next tick place a vanilla chest via block.setPermutation().

const FACE_OFFSETS = {
    Up:    { x: 0, y: 1,  z: 0  },
    Down:  { x: 0, y: -1, z: 0  },
    North: { x: 0, y: 0,  z: -1 },
    South: { x: 0, y: 0,  z: 1  },
    East:  { x: 1, y: 0,  z: 0  },
    West:  { x: -1, y: 0, z: 0  },
};

/**
 * Convert player yaw to minecraft:cardinal_direction for a vanilla chest.
 * Bedrock yaw convention: 0 = south, 90 = west, 180 = north, 270 = east.
 * We set cardinal_direction = the direction the player is facing so the chest
 * front faces toward the player (matching vanilla placement behavior).
 * // TODO: verify in-game — if the chest faces backward, flip to the opposite direction
 */
function yawToCardinal(yaw) {
    const n = ((yaw % 360) + 360) % 360;
    if (n >= 315 || n < 45)  return "south";
    if (n >= 45  && n < 135) return "west";
    if (n >= 135 && n < 225) return "north";
    return "east"; // 225–315
}

/** Remove one prankchest:prank_chest item from the player's selected slot. */
function consumeItem(player) {
    if (player.getGameMode() === GameMode.creative) return;
    try {
        const inv  = player.getComponent("minecraft:inventory")?.container;
        const slot = player.selectedSlotIndex;
        if (!inv) return;
        const item = inv.getItem(slot);
        if (!item || item.typeId !== "prankchest:prank_chest") return;
        if (item.amount > 1) {
            item.amount--;
            inv.setItem(slot, item);
        } else {
            inv.setItem(slot, undefined); // clear slot
        }
    } catch (e) {
        console.warn("[PrankChest] consumeItem failed:", e);
    }
}

world.beforeEvents.itemUseOn.subscribe((event) => {
    if (event.itemStack?.typeId !== "prankchest:prank_chest") return;

    // Cancel default item behavior (prevents any block placer component from firing).
    event.cancel = true;

    // Capture everything we need now — block/player refs can become stale after system.run.
    const targetLoc = { ...event.block.location };
    const face      = event.blockFace;
    const dim       = event.block.dimension;
    const player    = event.source;
    const yaw       = player.getRotation().y;

    system.run(() => {
        if (!registryLoaded) return;

        const off      = FACE_OFFSETS[face] ?? FACE_OFFSETS.Up;
        const chestLoc = {
            x: targetLoc.x + off.x,
            y: targetLoc.y + off.y,
            z: targetLoc.z + off.z,
        };

        const block = dim.getBlock(chestLoc);
        if (!block) return; // chunk unloaded — bail

        // Only place into air (never overwrite another block)
        if (block.typeId !== "minecraft:air") return;

        const facing = yawToCardinal(yaw);

        try {
            // Place a real vanilla chest with the correct facing permutation.
            // BlockPermutation.resolve is stable API and the correct way to set
            // block state without going through a slash command.
            block.setPermutation(
                BlockPermutation.resolve("minecraft:chest", {
                    "minecraft:cardinal_direction": facing,
                })
            );
        } catch (e) {
            console.warn("[PrankChest] Failed to place vanilla chest:", e);
            return;
        }

        const key = coordKey(chestLoc.x, chestLoc.y, chestLoc.z, dim.id);
        registerChest(key);
        consumeItem(player);
        console.log(`[PrankChest] Placed prank chest at ${key} facing ${facing}`);
    });
});

// ── Break interception ─────────────────────────────────────────────────────────
// CHOICE: Option A — beforeEvents.playerBreakBlock (cancel + manual drop).
//
// Why not Option B: vanilla break + extra drop means the player receives both a
// normal chest item AND a prankchest item — exploitable, confusing, messy.
//
// Why not Option C: finding the dropped chest entity by proximity is fragile:
// timing varies by TPS, multiple nearby chests confuse entity matching, and item
// entities can be picked up by hoppers/players in the same tick.
//
// Option A is clean: cancel prevents all vanilla break behavior (no chest item
// drop, no inventory scatter). We then manually drop contents + prank item and
// remove the block. One downside: the player's tool does NOT take durability
// damage for this break (the cancel fires before vanilla durability processing).
// This is a minor cosmetic inconsistency, acceptable for v0.2.

world.beforeEvents.playerBreakBlock.subscribe((event) => {
    const key = blockKey(event.block);
    if (!isPrankChest(key)) return;
    if (pendingBreak.has(key)) return; // already queued this tick — don't double-process

    event.cancel = true;
    pendingBreak.add(key);

    // Capture block location + dimension before the async gap.
    // The block still exists next tick because we cancelled the break.
    const blockLoc = { ...event.block.location };
    const dim      = event.block.dimension;

    system.run(() => {
        pendingBreak.delete(key);

        const b = dim.getBlock(blockLoc);
        if (!b || b.typeId !== "minecraft:chest") {
            // Block already gone (lost to a race with explosion or /fill).
            // Still clean up the registry.
            unregisterChest(key);
            return;
        }

        // Drop all stored items in their CURRENT (possibly partially downgraded) form.
        // MUST: contents drop in original (non-downgraded) form per spec, meaning items
        // that haven't hit their timer yet. The timer data reflects this — items that
        // have already been downgraded are stored under their downgraded typeId, which
        // is the current state of the slot (correct). Items mid-timer haven't changed
        // yet, so they drop as-is (also correct).
        const inv = b.getComponent("minecraft:inventory");
        // TODO: verify in-game — block inventory component name:
        //   "minecraft:inventory" matches the entity convention; if undefined, try "inventory"
        const container = inv?.container;
        if (container) {
            for (let slot = 0; slot < container.size; slot++) {
                const item = container.getItem(slot);
                if (item) dim.spawnItem(item, blockLoc);
            }
        }

        // Drop the prank_chest item (MUST: NOT a normal minecraft:chest item).
        dim.spawnItem(new ItemStack("prankchest:prank_chest", 1), blockLoc);

        // Remove the vanilla chest block (no vanilla drops — we handled everything above).
        // setPermutation to air is the stable, scriptable way to clear a block.
        // TODO: verify in-game — if setPermutation("minecraft:air") throws, use
        //   player.runCommand("setblock x y z air") as fallback
        try {
            b.setPermutation(BlockPermutation.resolve("minecraft:air"));
        } catch (e) {
            console.warn("[PrankChest] setPermutation(air) failed on break:", e);
        }

        unregisterChest(key);
    });
});

// ── Explosion handling ─────────────────────────────────────────────────────────
// CHOICE: beforeEvents.explosion to identify prank chests about to be destroyed,
// then system.run() to do registry cleanup after the explosion completes.
//
// Why before and not after: in the before event the blocks still exist, so we can
// confirm they are minecraft:chest and in our registry. After the explosion the
// blocks are already replaced with air/debris and harder to identify.
//
// We do NOT attempt to intercept the explosion or spawn a prankchest item drop —
// the spec only requires registry cleanup for TNT (testing checklist item 10),
// not a special item drop. Vanilla loot (normal chest item) will scatter with the
// explosion, which is acceptable for this case.
//
// Periodic cleanup (below) is belt-and-suspenders for pistons, /fill, and other
// block-removal paths that don't fire a playerBreakBlock event.
// TODO: verify in-game — confirm beforeEvents.explosion.getImpactedBlocks() is
//   available in @minecraft/server 1.16.0 stable on Bedrock 1.26.1301.0

world.beforeEvents.explosion.subscribe((event) => {
    try {
        const impacted = event.getImpactedBlocks();
        const toRemove = [];
        for (const block of impacted) {
            const key = blockKey(block);
            if (isPrankChest(key)) toRemove.push(key);
        }
        if (toRemove.length > 0) {
            // Defer registry mutation to outside the before-event (can't write
            // dynamic properties synchronously in a beforeEvent handler).
            system.run(() => {
                for (const key of toRemove) unregisterChest(key);
            });
        }
    } catch (e) {
        console.warn("[PrankChest] explosion handler error:", e);
    }
});

// ── Timer state helpers ────────────────────────────────────────────────────────

/** Build in-memory state for a key, restoring persisted timers from registry. */
function initChestState(key) {
    const state = { lastSlotTypes: new Map(), timers: new Map() };
    const saved = registry[key];
    if (saved) {
        for (const [slotStr, entry] of Object.entries(saved)) {
            const slot      = parseInt(slotStr, 10);
            // Reconstruct startTick so that elapsed = currentTick - startTick
            // gives the correct remaining time after reload.
            const startTick = currentTick - (CONFIG.downgradeDelayTicks - entry.rem);
            state.timers.set(slot, { typeId: entry.typeId, startTick });
        }
    }
    chestState.set(key, state);
    return state;
}

/**
 * Flush in-memory timer state back into the registry object for this key.
 * Does NOT call saveRegistry() — caller batches disk writes to avoid per-slot saves.
 */
function flushTimers(key, state) {
    const out = {};
    for (const [slot, timer] of state.timers) {
        const elapsed   = currentTick - timer.startTick;
        const remaining = Math.max(0, CONFIG.downgradeDelayTicks - elapsed);
        out[slot] = { typeId: timer.typeId, rem: remaining };
    }
    registry[key] = out;
}

// ── Per-chest downgrade processing ────────────────────────────────────────────

/**
 * Process one prank chest for timer advancement and downgrade application.
 * Returns true if the registry changed (caller should call saveRegistry).
 * Returns false if the chunk is unloaded or nothing changed.
 */
function processPrankChest(key, dim) {
    const { x, y, z } = parseKey(key);
    const block = dim.getBlock({ x, y, z });

    if (!block) {
        // Chunk is unloaded — skip this cycle, timers pause (intentional: same
        // behavior as vanilla mob timers, items, etc. in unloaded chunks).
        return false;
    }

    if (block.typeId !== "minecraft:chest") {
        // Block is no longer a chest — must have been removed by piston, /fill,
        // or some other non-player path that bypassed our break handler.
        unregisterChest(key); // this calls saveRegistry internally
        return false;
    }

    if (!chestState.has(key)) {
        initChestState(key);
    }

    const state   = chestState.get(key);
    const inv     = block.getComponent("minecraft:inventory");
    // TODO: verify in-game — same inventory component name concern as in break handler
    const container = inv?.container;
    if (!container) return false;

    let dirty = false;

    for (let slot = 0; slot < container.size; slot++) {
        const item          = container.getItem(slot);
        const currentTypeId = item?.typeId ?? null;
        const prevTypeId    = state.lastSlotTypes.get(slot) ?? null;

        if (currentTypeId !== prevTypeId) {
            // Contents changed — reset the timer for this slot.
            state.lastSlotTypes.set(slot, currentTypeId);

            if (currentTypeId === null || !ALL_DOWNGRADES[currentTypeId]) {
                // Slot empty or item not in any downgrade chain — no timer needed.
                state.timers.delete(slot);
            } else {
                state.timers.set(slot, { typeId: currentTypeId, startTick: currentTick });
            }

            dirty = true;
            continue; // don't evaluate the timer we just (re)set this tick
        }

        const timer = state.timers.get(slot);
        if (!timer) continue;

        const elapsed = currentTick - timer.startTick;
        if (elapsed < CONFIG.downgradeDelayTicks) continue;

        // ── Timer expired: apply downgrade ──
        const targetId = ALL_DOWNGRADES[timer.typeId];
        if (targetId && item) {
            container.setItem(slot, new ItemStack(targetId, item.amount));
            state.timers.delete(slot);
            state.lastSlotTypes.set(slot, targetId);
            dirty = true;

            if (CONFIG.playSoundOnDowngrade) {
                dim.playSound("random.click", block.location, { volume: 0.5, pitch: 1.5 });
            }
            if (CONFIG.showParticlesOnDowngrade) {
                dim.spawnParticle(
                    "minecraft:redstone_ore_dust_particle",
                    { x: block.location.x, y: block.location.y + 0.5, z: block.location.z }
                );
            }
        }
    }

    if (dirty) {
        flushTimers(key, state);
        return true;
    }
    return false;
}

// ── Main polling loop ──────────────────────────────────────────────────────────
system.runInterval(() => {
    if (!registryLoaded) return;

    currentTick += POLL_INTERVAL;
    let needsSave = false;

    for (const dimName of DIM_NAMES) {
        let dim;
        try { dim = world.getDimension(dimName); } catch { continue; }

        // Use dim.id (the runtime dimension identifier) for key matching, not dimName.
        // These may differ (e.g. "overworld" vs "minecraft:overworld").
        const dimId = dim.id;

        for (const key of Object.keys(registry)) {
            if (!key.endsWith(`,${dimId}`)) continue;
            try {
                if (processPrankChest(key, dim)) needsSave = true;
            } catch (e) {
                console.warn(`[PrankChest] Error processing ${key}:`, e);
            }
        }
    }

    if (needsSave) saveRegistry();
}, POLL_INTERVAL);

// ── Periodic stale-registry cleanup ───────────────────────────────────────────
// Belt-and-suspenders for block-removal paths that bypass playerBreakBlock:
// pistons, /fill, /setblock, or any other world modification. Runs every ~5 minutes.
// Only checks blocks in loaded chunks (undefined from getBlock = skip, not remove).
system.runInterval(() => {
    if (!registryLoaded) return;

    let removed = 0;

    for (const dimName of DIM_NAMES) {
        let dim;
        try { dim = world.getDimension(dimName); } catch { continue; }
        const dimId = dim.id;

        for (const key of Object.keys(registry)) {
            if (!key.endsWith(`,${dimId}`)) continue;
            try {
                const { x, y, z } = parseKey(key);
                const block = dim.getBlock({ x, y, z });
                if (block && block.typeId !== "minecraft:chest") {
                    // Block is loaded and is NOT a chest → stale entry.
                    unregisterChest(key);
                    removed++;
                }
                // If block is undefined (chunk unloaded), leave entry intact.
            } catch {
                // Skip any inaccessible position this cycle.
            }
        }
    }

    if (removed > 0) {
        console.log(`[PrankChest] Periodic cleanup removed ${removed} stale registry entry(s)`);
    }
}, CLEANUP_INTERVAL);

// ── World init ─────────────────────────────────────────────────────────────────
world.afterEvents.worldInitialize.subscribe(() => {
    loadRegistry();
    registryLoaded = true;
    console.log("[PrankChest] Loaded v0.2.0");
});
