// Prank Chest — Main Entry Point
// TODO: Implement core downgrade logic
// See docs/DESIGN.md for full specification

import { world, system } from "@minecraft/server";

// Configuration defaults
const CONFIG = {
    downgradeDelayTicks: 1000, // 1 in-game hour (50 real seconds)
    playSoundOnDowngrade: true,
    showParticlesOnDowngrade: false,
};

// Downgrade mappings — see docs/DESIGN.md for full chains
const ORE_DOWNGRADES = {
    "minecraft:ancient_debris": "minecraft:diamond_ore",
    "minecraft:diamond_ore": "minecraft:iron_ore",
    "minecraft:gold_ore": "minecraft:dirt",
    "minecraft:iron_ore": "minecraft:copper_ore",
    "minecraft:copper_ore": "minecraft:gold_ore",
    // Deepslate variants
    "minecraft:deepslate_diamond_ore": "minecraft:deepslate_iron_ore",
    "minecraft:deepslate_gold_ore": "minecraft:dirt",
    "minecraft:deepslate_iron_ore": "minecraft:deepslate_copper_ore",
    "minecraft:deepslate_copper_ore": "minecraft:deepslate_gold_ore",
};

const INGOT_DOWNGRADES = {
    "minecraft:netherite_ingot": "minecraft:diamond",
    "minecraft:diamond": "minecraft:iron_ingot",
    "minecraft:iron_ingot": "minecraft:copper_ingot",
    "minecraft:copper_ingot": "minecraft:gold_ingot",
    "minecraft:gold_ingot": "minecraft:dirt",
};

// Tool & armor downgrades are generated programmatically
const TOOL_TYPES = ["sword", "pickaxe", "hoe", "shovel", "axe"];
const ARMOR_TYPES = ["helmet", "chestplate", "leggings", "boots"];

const TOOL_TIER_CHAIN = ["netherite", "diamond", "iron", "wooden", "golden"];
const ARMOR_TIER_CHAIN = ["netherite", "diamond", "iron", "leather", "golden"];

function buildToolDowngrades() {
    const map = {};
    for (const tool of TOOL_TYPES) {
        for (let i = 0; i < TOOL_TIER_CHAIN.length - 1; i++) {
            const from = `minecraft:${TOOL_TIER_CHAIN[i]}_${tool}`;
            const to = `minecraft:${TOOL_TIER_CHAIN[i + 1]}_${tool}`;
            map[from] = to;
        }
        // Golden → dirt
        map[`minecraft:golden_${tool}`] = "minecraft:dirt";
    }
    return map;
}

function buildArmorDowngrades() {
    const map = {};
    for (const piece of ARMOR_TYPES) {
        for (let i = 0; i < ARMOR_TIER_CHAIN.length - 1; i++) {
            const from = `minecraft:${ARMOR_TIER_CHAIN[i]}_${piece}`;
            const to = `minecraft:${ARMOR_TIER_CHAIN[i + 1]}_${piece}`;
            map[from] = to;
        }
        // Golden → dirt
        map[`minecraft:golden_${piece}`] = "minecraft:dirt";
    }
    return map;
}

const TOOL_DOWNGRADES = buildToolDowngrades();
const ARMOR_DOWNGRADES = buildArmorDowngrades();

// Combined lookup
const ALL_DOWNGRADES = {
    ...ORE_DOWNGRADES,
    ...INGOT_DOWNGRADES,
    ...TOOL_DOWNGRADES,
    ...ARMOR_DOWNGRADES,
};

/**
 * Get the downgrade target for an item ID.
 * Returns undefined if the item is not in any downgrade chain.
 */
export function getDowngrade(itemId) {
    return ALL_DOWNGRADES[itemId];
}

// TODO: Implement the following:
// 1. Custom block / entity registration for Prank Chest
// 2. Crafting recipe registration
// 3. Container interaction handling
// 4. Per-slot timer system
// 5. Item replacement logic on timer expiry
// 6. Sound/particle effects

world.afterEvents.worldInitialize.subscribe(() => {
    console.log("[Prank Chest] Addon loaded! v0.1.0");
});
