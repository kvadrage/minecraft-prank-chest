# Prank Chest — Claude Context

## What this project is
A Minecraft Bedrock Edition 1.21.50+ addon. A chest that looks identical to a vanilla chest but secretly downgrades items placed inside after a configurable delay (default 1000 ticks = 50 seconds).

## Current version
**v0.2.0** on branch `feat/v0.2-vanilla-chest` (not yet merged to main).  
v0.1.1 is on `main`. Do not merge until in-game testing passes (see QUESTIONS.md).

## Tech stack
- `@minecraft/server` **stable 1.16.0** (not beta)
- Target: Bedrock 1.21.50+ (tested on 1.26.1301.0)
- All source files under `src/behavior_pack/` and `src/resource_pack/`
- Development: junction links on Windows so changes go live on game restart

## Architecture: vanilla chest + prank registry (v0.2)
The placed chest is a **real `minecraft:chest`** — not a custom entity or custom block.

- **Custom item** `prankchest:prank_chest` — defined in `items/prank_chest.json`
- When placed, `world.beforeEvents.itemUseOn` cancels the default use, then `system.run()` places a vanilla chest via `block.setPermutation(BlockPermutation.resolve("minecraft:chest", {...}))`
- **Prank registry** stored in world dynamic property `"prankchest:registry"` — a JSON map keyed by `"x,y,z,dimId"` (where dimId = `dimension.id` runtime value). Survives world reload.
- Registry value per chest: `{ [slot]: { typeId, rem } }` — only active timer slots stored; empty `{}` marks a chest as prank with no active timers

## Timer system (scripts/main.js)
- Polls all registered prank chests every 20 ticks across all dimensions
- Per-slot timers in `Map<key, {lastSlotTypes, timers}>` (in-memory, rebuilt from registry on first access)
- On change/expiry: flush timers to `registry[key]`, batch `saveRegistry()` call
- Timers pause when chunk is unloaded (skip on `getBlock()` returning undefined) — intentional
- `entityDie` event does NOT apply (no entity). Break/explosion handling replaces it.

## Break interception (Option A)
`beforeEvents.playerBreakBlock` → cancel → `system.run()`:
1. Read block inventory via `block.getComponent("minecraft:inventory")?.container`
2. `dim.spawnItem()` all contents + one `prankchest:prank_chest` item
3. `block.setPermutation(BlockPermutation.resolve("minecraft:air"))` to clear the block
4. `unregisterChest(key)`

**Trade-off:** player tool does not consume durability on the break (cancel fires before vanilla durability processing). Acceptable for v0.2.

## Explosion handling
`beforeEvents.explosion` → check `getImpactedBlocks()` for prank chest keys → `system.run()` to `unregisterChest()`. Plus 5-minute periodic stale sweep for pistons/fill/etc.

TNT drops a normal chest item (vanilla loot) — NOT a prank_chest item. Spec only requires registry cleanup for explosions (test checklist item 10), not special drops.

## Recipe
```
[ Plank ] [ Tripwire Hook ] [ Plank ]
[ Plank ] [ Redstone Dust ] [ Plank ]
[ Plank ] [    Plank      ] [ Plank ]
```
Any plank variant (`tag: minecraft:planks`). Tripwire hook = thematic trap.

## Downgrade chains
See `scripts/main.js` — `ALL_DOWNGRADES` map. Covers ores (incl. deepslate), ingots/gems, tools, armor. Copper tier skipped (Option A) — iron → wooden (tools) / leather (armor).

## File structure (v0.2)
```
src/behavior_pack/
  items/prank_chest.json        ← custom item definition
  recipes/prank_chest.json      ← crafting recipe
  scripts/main.js               ← all logic
  texts/en_US.lang              ← item.prankchest:prank_chest.name=Chest
  manifest.json                 ← v0.2.0, depends on resource pack uuid 084bec7c
  pack_icon.png
src/resource_pack/
  textures/item_texture.json    ← "prank_chest" → textures/blocks/chest_front
  textures/blocks/chest_*.png   ← chest face textures (used for item icon)
  texts/en_US.lang
  manifest.json                 ← v0.2.0, uuid 084bec7c
  pack_icon.png
```

## Deleted in v0.2 (do not re-add)
- `behavior_pack/blocks/` — no custom block in world
- `behavior_pack/entities/` — no custom entity
- `behavior_pack/loot_tables/` — entity-based drop handling gone
- `resource_pack/animation_controllers/` — no entity animations
- `resource_pack/animations/` — same
- `resource_pack/entity/` — no client entity definition
- `resource_pack/models/` — no custom geometry
- `resource_pack/render_controllers/` — no entity rendering
- `resource_pack/textures/terrain_texture.json` — no custom block
- `resource_pack/textures/entity/` — entity texture gone

## Known open questions (QUESTIONS.md)
Before merging to main, these must be verified in-game:
1. Block inventory component name: `"minecraft:inventory"` vs `"inventory"`
2. `block.setPermutation(BlockPermutation.resolve("minecraft:air"))` actually clears the block
3. `"minecraft:cardinal_direction"` is the correct block state key for chest facing
4. Chest facing direction convention (player-facing vs away)
5. `beforeEvents.explosion.getImpactedBlocks()` available in stable 1.16.0
6. `Dimension.id` format (`"overworld"` vs `"minecraft:overworld"`)
7. World dynamic property string size limit
8. `beforeEvents.itemUseOn` fires for custom items without `block_placer`

## Migration note (v0.1.x → v0.2)
Breaking change. Existing prank chest entities won't work.
Run `/kill @e[type=prankchest:prank_chest]` before switching to v0.2.
