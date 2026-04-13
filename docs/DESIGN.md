# Prank Chest — Design Specification

## Overview

**Prank Chest** is a custom block that looks and behaves exactly like a normal chest, with one key difference: items placed inside it are secretly downgraded to lower-tier equivalents after a configurable delay.

## Crafting Recipe

Same as a regular chest, but with **Redstone Dust** in the center slot:

```
[Plank] [Plank]  [Plank]
[Plank] [Redstone Dust] [Plank]
[Plank] [Plank]  [Plank]
```

- Uses any wood plank variant (oak, birch, spruce, etc.)
- Yields: 1 Prank Chest

## Visual Appearance

- **Identical** to a normal chest in all aspects:
  - Same texture
  - Same opening/closing animation
  - Same sounds
  - No visual indicator that it's a Prank Chest
- Players cannot distinguish a Prank Chest from a regular one without breaking it (drops "Prank Chest" item)

## Core Mechanic — Timed Item Downgrade

### Trigger

- When a player places an item into the Prank Chest, a **countdown timer** starts for that item
- After the timer expires, the item is **replaced** with its downgraded equivalent
- Default delay: **1 in-game hour** (= 50 real-world seconds at default daylight cycle speed)
- Delay is **configurable** via addon settings (see Configuration section)

### Timer Behavior

- Each item slot has its own independent timer
- Timer starts when the item is **placed** into the chest
- Timer **resets** if the item is removed before expiration
- If the chest is broken before the timer expires, items drop in their **original** form
- Stacked items are downgraded as a whole stack (e.g., 32 diamond ore → 32 iron ore)

## Downgrade Chains

### Ores

| Original | Downgraded To |
|----------|---------------|
| Ancient Debris (Netherite) | Diamond Ore |
| Diamond Ore | Iron Ore |
| Gold Ore | Dirt |
| Iron Ore | Copper Ore |
| Copper Ore | Gold Ore |

> Note: Deepslate variants follow the same chain (e.g., Deepslate Diamond Ore → Deepslate Iron Ore). Nether Gold Ore follows Gold Ore rules.

### Ingots / Gems

| Original | Downgraded To |
|----------|---------------|
| Netherite Ingot | Diamond |
| Diamond | Iron Ingot |
| Iron Ingot | Copper Ingot |
| Copper Ingot | Gold Ingot |
| Gold Ingot | Dirt |

### Tools

Applies to: **Sword, Pickaxe, Hoe, Shovel, Axe**

| Original Tier | Downgraded To |
|---------------|---------------|
| Netherite | Diamond |
| Diamond | Iron |
| Iron | Copper* |
| Copper* | Wooden |
| Wooden | Golden |
| Golden | Dirt |

> *Note: Copper tools don't exist in vanilla Bedrock. Options:
> - **Option A:** Skip copper tier (Iron → Wooden)
> - **Option B:** If a copper tools mod is present, support it
>
> **Decision: Use Option A for v1.0** — Iron → Wooden for tools.

### Armor

Applies to: **Helmet, Chestplate, Leggings, Boots**

| Original Tier | Downgraded To |
|---------------|---------------|
| Netherite | Diamond |
| Diamond | Iron |
| Iron | Copper* |
| Copper* | Leather |
| Leather | Golden |
| Golden | Dirt |

> *Note: Same issue as tools — copper armor doesn't exist in vanilla.
>
> **Decision: Use Option A for v1.0** — Iron → Leather for armor.

### Items Not in Any Chain

- Items that don't match any downgrade rule are **left unchanged**
- Food, potions, blocks (except ores), etc. are not affected

## Configuration

Settings accessible via addon configuration (world settings or `variables.json`):

| Setting | Default | Description |
|---------|---------|-------------|
| `downgrade_delay_ticks` | 1000 | Delay before downgrade in game ticks (1000 ticks = 50 sec = 1 in-game hour) |
| `play_sound_on_downgrade` | true | Play a subtle sound when downgrade occurs |
| `show_particles_on_downgrade` | false | Show particles when downgrade happens (off by default — too obvious) |

## Sound & Particle Effects (Optional)

- **Sound on downgrade:** A quiet, subtle "click" or "shimmer" — should not be obvious
- **Particles:** Disabled by default; if enabled, a small puff of redstone particles inside the chest

## Technical Notes

### Block Identity
- Custom block ID: `prankchest:prank_chest`
- Must register with `BlockPermutation` to behave like a container
- Needs custom container component via Script API

### Script API Requirements
- `@minecraft/server` — for block events, inventory management, scheduling
- `@minecraft/server-ui` (optional) — if we add settings UI later

### Key Implementation Challenges
1. **Custom container block** — Bedrock doesn't easily allow custom blocks with chest-like inventory UI. Approaches:
   - Use `minecraft:entity` with inventory component (entity-based chest)
   - Use script API to intercept interactions and manage virtual inventory
   - Override vanilla chest behavior when placed in specific conditions
2. **Timer system** — need persistent per-slot timers that survive chunk unloading
3. **Visual mimicry** — matching vanilla chest appearance exactly

### Recommended Approach (v1.0)
Use an **entity-based approach**:
- Prank Chest is a custom entity with `minecraft:inventory` component
- Placed as a block with entity attached (like vanilla chest entity)
- Script API handles the downgrade logic via `system.runInterval()`

## Future Ideas

- **Upgrade Chest** — opposite effect, upgrades items (much rarer recipe)
- **Random Chest** — randomly upgrades OR downgrades
- **Troll notifications** — optional chat message when someone gets pranked
- **Statistics** — track how many items have been pranked

## Known Limitations (v0.1)

- **Block item icon** shows as oak planks, not a chest texture — needs custom icon PNG in `textures/items/` + `minecraft:icon` in block JSON
- **No lid-open animation** — entity is static; animation requires animation controller wired to player-proximity query (v0.2)
- **Container interaction** relies on Bedrock's native `minecraft:inventory` behavior — if chest screen doesn't open in some versions, may need `playerInteractWithEntity` handler workaround
- **Visual "blink"** — block placeholder briefly visible before entity spawns

## Version History

| Version | Status | Notes |
|---------|--------|-------|
| v0.1 | ✅ Done | Entity-based chest, all downgrade chains, per-slot timers, crafting recipe, persistence |
| v0.2 | 🚧 Planned | Lid animation, proper block icon, container interaction fix |
