# Prank Chest — Claude Context

## What this project is
A Minecraft Bedrock Edition 1.21.50+ addon. A chest that looks identical to a vanilla chest but secretly downgrades items placed inside after a configurable delay (default 1000 ticks = 50 seconds).

## Tech stack
- `@minecraft/server` **stable 1.16.0** (not beta)
- Target: Bedrock 1.21.50+
- All source files under `src/behavior_pack/` and `src/resource_pack/`
- Development: junction links on Windows so changes go live on game restart

## Architecture: entity-based chest
The prank chest is a **custom entity** (`prankchest:prank_chest`), not a custom block, because custom blocks can't natively open a 27-slot chest UI in Bedrock.

- The **craftable item** is a custom block (`prankchest:prank_chest`), format_version `"1.21.40"`
- When placed, `world.beforeEvents.itemUseOn` cancels the block placement and spawns the entity directly — no block-flash
- The entity has `minecraft:inventory` (27 slots, container_type chest) + `minecraft:interact` (both required for the chest UI to open on right-click)
- The entity has no gravity (`minecraft:physics: {has_gravity: false}`) and is not pushable

## Timer system (scripts/main.js)
- Polls all `prankchest:prank_chest` entities every 20 ticks across all dimensions
- Per-slot timers stored in `Map<entityId, {lastSlotTypes, timers}>`
- Timers persisted across restarts via `entity.setDynamicProperty("prank_chest_timers", JSON.stringify(...))`  stored as `{slot: {typeId, ticksRemaining}}`
- On expiry: `container.setItem(slot, new ItemStack(downgradeId, amount))`
- `entityDie` event drops inventory contents (handles both player breaking and TNT/explosions)

## Animation
- Entity property `prankchest:is_open` (bool, client_sync) drives lid animation
- 4-state controller: closed → opening → open → closing
- `playerInteractWithEntity` sets property true + plays `mob.chest.open`
- Poll loop closes chest (sets false + plays `mob.chest.close`) when no player within 5 blocks

## Geometry
- Primary: `geometry.chest` (vanilla built-in, referenced in `resource_pack/entity/prank_chest.entity.json`)
- Fallback: `geometry.prank_chest` (custom geo in `resource_pack/models/entity/prank_chest.geo.json`) — switch to this in the entity JSON if vanilla geo doesn't resolve
- Material: `entity_alphatest`
- Texture: `textures/entity/chest/normal` (vanilla chest texture)

## Recipe
```
[ Plank ] [ Tripwire Hook ] [ Plank ]
[ Plank ] [ Redstone Dust ] [ Plank ]
[ Plank ] [    Plank      ] [ Plank ]
```
Any plank variant (uses `tag: minecraft:planks`). Tripwire hook is intentional — thematically a trap.

## Downgrade chains
See `scripts/main.js` — `ALL_DOWNGRADES` map. Covers ores (incl. deepslate), ingots/gems, tools, armor. Copper tier skipped (Option A) — iron goes directly to wooden (tools) / leather (armor).

## Known TODOs
- **Pack icons**: need 256×256+ `pack_icon.png` in both `src/behavior_pack/` and `src/resource_pack/`
- **Inventory item icon**: block item shows as a chest-textured cube (via `terrain_texture.json`), but a proper 2D sprite would require `textures/items/prank_chest.png` + `minecraft:icon` wired in block JSON
- **Lid close detection**: proximity-based (5 blocks), not exact "player closed inventory" — no stable API for that yet
