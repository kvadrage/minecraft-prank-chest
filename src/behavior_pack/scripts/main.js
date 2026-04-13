// Prank Chest — Main Script  v0.1.1
// Entity-based approach: prank_chest entity owns inventory; script manages timers.

import {
    world,
    system,
    BlockPermutation,
    ItemStack,
    GameMode,
} from "@minecraft/server";

// ── Configuration ──────────────────────────────────────────────────────────────
const CONFIG = {
    downgradeDelayTicks: 1000,      // Default: 1 in-game hour (50 real seconds)
    playSoundOnDowngrade: true,
    showParticlesOnDowngrade: false,
};

// ── Downgrade tables ───────────────────────────────────────────────────────────
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

/** Returns the downgrade target item ID, or undefined if not in any chain. */
export function getDowngrade(itemId) {
    return ALL_DOWNGRADES[itemId];
}

// ── State maps ─────────────────────────────────────────────────────────────────
// Timer state: entityId → { lastSlotTypes: Map<slot, string|null>, timers: Map<slot, {typeId, startTick}> }
const chestState = new Map();
// Open-chest tracking for animation + close sound
const openChests = new Map(); // entityId → { entity, lastInteractTick }
let currentTick  = 0;

const POLL_INTERVAL = 20; // scan every 20 ticks ≈ 1 second
const DIM_IDS       = ["overworld", "nether", "the_end"];

// ── Placement helpers ──────────────────────────────────────────────────────────
const FACE_OFFSETS = {
    Up:    { x: 0, y: 1,  z: 0  },
    Down:  { x: 0, y: -1, z: 0  },
    North: { x: 0, y: 0,  z: -1 },
    South: { x: 0, y: 0,  z: 1  },
    East:  { x: 1, y: 0,  z: 0  },
    West:  { x: -1, y: 0, z: 0  },
};

/** Entity spawn position: centre of the adjacent block for the given face. */
function getSpawnLoc(blockLoc, face) {
    const off = FACE_OFFSETS[face] ?? FACE_OFFSETS.Up;
    return {
        x: blockLoc.x + off.x + 0.5,
        y: blockLoc.y + off.y,
        z: blockLoc.z + off.z + 0.5,
    };
}

/** Remove one prank chest item from the player's hand (survival/adventure only). */
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

// ── Placement: item use on block → spawn entity (REQ-6: zero block flash) ─────
world.beforeEvents.itemUseOn.subscribe((event) => {
    if (event.itemStack?.typeId !== "prankchest:prank_chest") return;

    // Cancel default block placement — entity will be spawned instead
    event.cancel = true;

    const blockLoc  = { ...event.block.location };
    const face      = event.blockFace;
    const dim       = event.block.dimension;
    const spawnLoc  = getSpawnLoc(blockLoc, face);
    const player    = event.source;
    const playerYaw = player.getRotation().y;

    system.run(() => {
        // Validate: target space must be air
        const adjBlock = dim.getBlock({
            x: Math.floor(spawnLoc.x),
            y: Math.floor(spawnLoc.y),
            z: Math.floor(spawnLoc.z),
        });
        if (!adjBlock || adjBlock.typeId !== "minecraft:air") return;

        // Spawn entity and orient it to face toward the player (REQ-2)
        // Chest yaw = playerYaw + 180 so the opening faces back at the player
        const entity    = dim.spawnEntity("prankchest:prank_chest", spawnLoc);
        const chestYaw  = ((playerYaw + 180) % 360 + 360) % 360;
        entity.setRotation({ x: 0, y: chestYaw });

        consumeItem(player);
    });
});

// ── Interaction: open sound + animation trigger (REQ-3) ────────────────────────
world.afterEvents.playerInteractWithEntity.subscribe((event) => {
    const entity = event.target;
    if (entity.typeId !== "prankchest:prank_chest") return;

    try {
        entity.setProperty("prankchest:is_open", true);
        entity.dimension.playSound("mob.chest.open", entity.location, {
            volume: 0.7,
            pitch: 0.9,
        });
        openChests.set(entity.id, { entity, lastInteractTick: currentTick });
    } catch (e) {
        console.warn("[PrankChest] Open chest error:", e);
    }
});

// ── Main polling loop ──────────────────────────────────────────────────────────
system.runInterval(() => {
    currentTick += POLL_INTERVAL;

    // ── Auto-close chests when players move away (REQ-3) ──
    for (const [entityId, info] of openChests) {
        let shouldClose = true;
        try {
            const nearby = info.entity.dimension.getPlayers({
                location: info.entity.location,
                maxDistance: 5,
            });
            shouldClose = nearby.length === 0;
        } catch {
            // Entity no longer valid
            chestState.delete(entityId);
            openChests.delete(entityId);
            continue;
        }

        if (shouldClose) {
            try {
                info.entity.setProperty("prankchest:is_open", false);
                info.entity.dimension.playSound("mob.chest.close", info.entity.location, {
                    volume: 0.7,
                    pitch: 0.9,
                });
            } catch { /* entity gone mid-loop */ }
            openChests.delete(entityId);
        }
    }

    // ── Downgrade timer logic ──
    for (const dimId of DIM_IDS) {
        let dim;
        try { dim = world.getDimension(dimId); } catch { continue; }

        for (const entity of dim.getEntities({ type: "prankchest:prank_chest" })) {
            try {
                processPrankChest(entity);
            } catch (e) {
                console.warn(`[PrankChest] Error processing ${entity.id}: ${e}`);
            }
        }
    }
}, POLL_INTERVAL);

function processPrankChest(entity) {
    const id = entity.id;

    if (!chestState.has(id)) {
        const state = { lastSlotTypes: new Map(), timers: new Map() };
        chestState.set(id, state);
        restoreTimers(entity, state);
    }

    const state   = chestState.get(id);
    const invComp = entity.getComponent("minecraft:inventory");
    if (!invComp?.container) return;

    const container = invComp.container;
    let dirty = false;

    for (let slot = 0; slot < container.size; slot++) {
        const item          = container.getItem(slot);
        const currentTypeId = item?.typeId ?? null;
        const prevTypeId    = state.lastSlotTypes.get(slot) ?? null;

        if (currentTypeId !== prevTypeId) {
            // Slot contents changed — reset timer
            state.lastSlotTypes.set(slot, currentTypeId);

            if (currentTypeId === null) {
                state.timers.delete(slot);
            } else if (ALL_DOWNGRADES[currentTypeId]) {
                state.timers.set(slot, { typeId: currentTypeId, startTick: currentTick });
            } else {
                state.timers.delete(slot);
            }

            dirty = true;
            continue;
        }

        const timer = state.timers.get(slot);
        if (!timer) continue;

        const elapsed = currentTick - timer.startTick;
        if (elapsed < CONFIG.downgradeDelayTicks) continue;

        // ── Timer expired: perform downgrade ──
        const targetId = ALL_DOWNGRADES[timer.typeId];
        if (targetId && item) {
            container.setItem(slot, new ItemStack(targetId, item.amount));
            state.timers.delete(slot);
            state.lastSlotTypes.set(slot, targetId);
            dirty = true;

            if (CONFIG.playSoundOnDowngrade) {
                entity.dimension.playSound("random.click", entity.location, {
                    volume: 0.5,
                    pitch: 1.5,
                });
            }

            if (CONFIG.showParticlesOnDowngrade) {
                entity.dimension.spawnParticle(
                    "minecraft:redstone_ore_dust_particle",
                    { x: entity.location.x, y: entity.location.y + 0.5, z: entity.location.z }
                );
            }
        }
    }

    if (dirty) saveTimers(entity, state);
}

// ── Timer persistence ──────────────────────────────────────────────────────────
function saveTimers(entity, state) {
    const data = {};
    for (const [slot, timer] of state.timers) {
        const elapsed   = currentTick - timer.startTick;
        const remaining = Math.max(0, CONFIG.downgradeDelayTicks - elapsed);
        data[slot] = { typeId: timer.typeId, ticksRemaining: remaining };
    }
    try {
        entity.setDynamicProperty("prank_chest_timers", JSON.stringify(data));
    } catch (e) {
        console.warn("[PrankChest] Failed to save timers:", e);
    }
}

function restoreTimers(entity, state) {
    try {
        const raw = entity.getDynamicProperty("prank_chest_timers");
        if (typeof raw !== "string") return;

        const data = JSON.parse(raw);
        for (const [slotStr, entry] of Object.entries(data)) {
            const slot      = parseInt(slotStr, 10);
            const startTick = currentTick - (CONFIG.downgradeDelayTicks - entry.ticksRemaining);
            state.timers.set(slot, { typeId: entry.typeId, startTick });
        }
    } catch (e) {
        console.warn("[PrankChest] Failed to restore timers:", e);
    }
}

// ── Entity death → drop inventory (covers breaks AND explosions — REQ-4) ───────
world.afterEvents.entityDie.subscribe((event) => {
    const entity = event.deadEntity;
    if (entity.typeId !== "prankchest:prank_chest") return;

    const dim = entity.dimension;
    const loc = { ...entity.location };

    // Scatter all stored items — items haven't been downgraded yet if timer
    // hadn't expired, so they drop in original form automatically.
    const invComp = entity.getComponent("minecraft:inventory");
    if (invComp?.container) {
        const container = invComp.container;
        for (let slot = 0; slot < container.size; slot++) {
            const item = container.getItem(slot);
            if (item) dim.spawnItem(item, loc);
        }
    }

    // Loot table (defined in loot_tables/entities/prank_chest.json)
    // handles dropping the prank_chest block item itself.

    chestState.delete(entity.id);
    openChests.delete(entity.id);
});

world.afterEvents.worldInitialize.subscribe(() => {
    console.log("[PrankChest] Loaded v0.1.1");
});
