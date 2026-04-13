// Prank Chest — Main Script  v0.1.0
// Entity-based approach: prank_chest entity owns inventory; script manages timers.

import { world, system, BlockPermutation, ItemStack } from "@minecraft/server";

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
    // Deepslate variants
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

/**
 * Returns the downgrade target item ID, or undefined if not in any chain.
 */
export function getDowngrade(itemId) {
    return ALL_DOWNGRADES[itemId];
}

// ── State tracking ─────────────────────────────────────────────────────────────
// entityId → { lastSlotTypes: Map<slot, string|null>, timers: Map<slot, {typeId, startTick}> }
//
// lastSlotTypes tracks what was in each slot on the previous poll so we can
// detect placement/removal without an item-change event.
//
// timers tracks per-slot countdowns. startTick is relative to `currentTick`
// which starts at 0 each session — ticksRemaining is persisted across restarts.
const chestState = new Map();
let currentTick = 0;

const POLL_INTERVAL = 20; // scan inventory every 20 ticks (≈1 second)
const DIM_IDS = ["overworld", "nether", "the_end"];

// ── Main polling loop ──────────────────────────────────────────────────────────
system.runInterval(() => {
    currentTick += POLL_INTERVAL;

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

    // First time we see this entity: init state and reload persisted timers
    if (!chestState.has(id)) {
        const state = { lastSlotTypes: new Map(), timers: new Map() };
        chestState.set(id, state);
        restoreTimers(entity, state);
    }

    const state = chestState.get(id);
    const invComp = entity.getComponent("minecraft:inventory");
    if (!invComp?.container) return;

    const container = invComp.container;
    let dirty = false;

    for (let slot = 0; slot < container.size; slot++) {
        const item          = container.getItem(slot);
        const currentTypeId = item?.typeId ?? null;
        const prevTypeId    = state.lastSlotTypes.get(slot) ?? null;

        if (currentTypeId !== prevTypeId) {
            // Slot contents changed — update tracking and reset/start timer
            state.lastSlotTypes.set(slot, currentTypeId);

            if (currentTypeId === null) {
                // Item removed — cancel timer
                state.timers.delete(slot);
            } else if (ALL_DOWNGRADES[currentTypeId]) {
                // Downgradeable item placed — start countdown
                state.timers.set(slot, { typeId: currentTypeId, startTick: currentTick });
            } else {
                // Non-downgradeable item — no timer needed
                state.timers.delete(slot);
            }

            dirty = true;
            continue;
        }

        // Same type as last poll — check if timer has expired
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
                entity.dimension.playSound(
                    "random.click",
                    entity.location,
                    { volume: 0.5, pitch: 1.5 }
                );
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
// Timers survive chunk unloads and server restarts via entity dynamic properties.
// We store ticksRemaining (not absolute startTick) so restarts don't corrupt timers.

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
            // Reconstruct a startTick such that elapsed = delay - remaining
            const startTick = currentTick - (CONFIG.downgradeDelayTicks - entry.ticksRemaining);
            state.timers.set(slot, { typeId: entry.typeId, startTick });
        }
    } catch (e) {
        console.warn("[PrankChest] Failed to restore timers:", e);
    }
}

// ── Block → entity conversion ──────────────────────────────────────────────────
// The craftable item is a block (prankchest:prank_chest).  The moment it's placed
// we swap it for the actual chest entity so inventory and timer logic can run.
world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (event.block.typeId !== "prankchest:prank_chest") return;

    const blockLoc = { ...event.block.location };
    const dim      = event.block.dimension;

    // Defer one tick so the block placement event fully resolves first
    system.run(() => {
        const block = dim.getBlock(blockLoc);
        block?.setPermutation(BlockPermutation.resolve("minecraft:air"));

        dim.spawnEntity("prankchest:prank_chest", {
            x: blockLoc.x + 0.5,
            y: blockLoc.y,
            z: blockLoc.z + 0.5,
        });
    });
});

// ── Entity destroyed → drop inventory ─────────────────────────────────────────
// When the chest entity is killed (players break it), explicitly scatter its
// contents as item drops.  The loot table drops the prank_chest item itself.
world.afterEvents.entityDie.subscribe((event) => {
    const entity = event.deadEntity;
    if (entity.typeId !== "prankchest:prank_chest") return;

    const dim = entity.dimension;
    const loc = { ...entity.location };

    const invComp = entity.getComponent("minecraft:inventory");
    if (invComp?.container) {
        const container = invComp.container;
        for (let slot = 0; slot < container.size; slot++) {
            const item = container.getItem(slot);
            if (item) dim.spawnItem(item, loc);
        }
    }

    chestState.delete(entity.id);
});

world.afterEvents.worldInitialize.subscribe(() => {
    console.log("[PrankChest] Loaded v0.1.0");
});
