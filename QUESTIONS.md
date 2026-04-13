# QUESTIONS — v0.2 In-Game Verification Needed

These are implementation decisions or API assumptions that cannot be verified without
running on Bedrock 1.26.1301.0. Each one has a corresponding `// TODO: verify in-game`
comment in `scripts/main.js`. Please test and report back so we can fix any that are wrong.

---

## Q1 — Block inventory component name for vanilla chests

**Code:** `block.getComponent("minecraft:inventory")`  
**File:** `scripts/main.js` — break handler and `processPrankChest()`  
**Question:** Does a vanilla `minecraft:chest` block expose its inventory via
`block.getComponent("minecraft:inventory")`? Or is the correct name just `"inventory"`?  
**Why it matters:** If this returns `undefined`, we cannot read the chest contents on
break (items won't drop) or run downgrade timers.  
**Fallback to try:** Replace `"minecraft:inventory"` with `"inventory"` in both call sites.

---

## Q2 — `block.setPermutation(BlockPermutation.resolve("minecraft:air"))` to clear a block

**Code:** `b.setPermutation(BlockPermutation.resolve("minecraft:air"))`  
**File:** `scripts/main.js` — break handler  
**Question:** Does setting a block's permutation to `minecraft:air` actually remove the
block from the world? This is the intended way to destroy the chest after we've manually
dropped its contents.  
**Why it matters:** If this silently fails, the chest stays in the world as a ghost
(impossible to break, still registered as prank chest).  
**Fallback to try:** `player.runCommand("setblock " + x + " " + y + " " + z + " air")`

---

## Q3 — `BlockPermutation.resolve("minecraft:chest", {"minecraft:cardinal_direction": dir})`

**Code:** `block.setPermutation(BlockPermutation.resolve("minecraft:chest", { "minecraft:cardinal_direction": facing }))`  
**File:** `scripts/main.js` — placement handler  
**Question:** Is `"minecraft:cardinal_direction"` the correct block state key for chest
facing on Bedrock 1.26.1301.0? Valid values should be `"north"`, `"south"`, `"east"`,
`"west"`.  
**Why it matters:** Wrong key → chest placed facing the wrong direction or not placed at all.  
**Fallback to try:** Check `block.permutation.getAllStates()` on a real chest to see the
exact key name.

---

## Q4 — Chest facing direction convention

**Code:** `yawToCardinal()` — maps player yaw to `minecraft:cardinal_direction`  
**File:** `scripts/main.js`  
**Question:** When a player faces south (yaw ≈ 0) and places a chest, should
`cardinal_direction` be `"south"` (chest front faces toward player) or `"north"` (chest
front faces away)?  
**Current implementation:** `cardinal_direction = player's facing direction` (e.g. player
faces south → cardinal = south).  
**Fix if wrong:** In `yawToCardinal()`, return the opposite direction:
`"south"→"north"`, `"north"→"south"`, `"east"→"west"`, `"west"→"east"`.  
This is a one-line change.

---

## Q5 — `world.beforeEvents.explosion.getImpactedBlocks()` availability

**Code:** `event.getImpactedBlocks()` in the `beforeEvents.explosion` handler  
**File:** `scripts/main.js`  
**Question:** Is `getImpactedBlocks()` available on the explosion before-event in
`@minecraft/server` 1.16.0 stable? The function is wrapped in a try/catch so failure
will only produce a console warning rather than a crash, but if it's missing, explosions
won't clean up the registry.  
**Fallback:** The 5-minute periodic cleanup will still catch stale entries eventually.
If confirmed unavailable, remove the explosion handler and document this limitation.

---

## Q6 — `Dimension.id` format

**Code:** `block.dimension.id` used as the dimension suffix in registry keys  
**File:** `scripts/main.js` — `blockKey()`, `coordKey()`, poll loop  
**Question:** Does `Dimension.id` return `"overworld"` or `"minecraft:overworld"` in
stable 1.16.0 on Bedrock 1.26.1301.0?  
**Why it matters:** The format is used as the suffix in registry keys AND to filter keys
in the poll loop. As long as it's consistent (we always use `dim.id` both when writing
and reading keys), any format works.  
**Easy diagnostic:** On world load, the registry loads 0 chests (fresh world). Place one
prank chest and check the content log for `[PrankChest] Placed prank chest at ...` — the
key it logs tells you exactly what format is being used.

---

## Q7 — `world.setDynamicProperty` string size limit

**Code:** `world.setDynamicProperty(REGISTRY_PROP, str)` in `saveRegistry()`  
**File:** `scripts/main.js`  
**Question:** What is the actual string size limit for `world.setDynamicProperty` in
stable 1.16.0 on Bedrock 1.26.1301.0?  
**Current assumption:** 32767 chars (standard for dynamic properties). We warn at 32000.  
**Why it matters:** If the limit is lower, large registries will fail to save silently.
If higher, the warning threshold can be relaxed.  
**Easy diagnostic:** Place 50+ prank chests with active timers and check for the
`Registry is ... chars` warning in the content log.

---

## Q8 — `beforeEvents.itemUseOn` fires without a `minecraft:block_placer` component

**Code:** `world.beforeEvents.itemUseOn.subscribe(...)` filtered on `prankchest:prank_chest`  
**File:** `scripts/main.js`  
**Question:** Does `beforeEvents.itemUseOn` fire when right-clicking a block while
holding a custom item that has NO `minecraft:block_placer` component?  
**Current assumption:** Yes — `itemUseOn` fires for any item used on a block.  
**Why it matters:** If it doesn't fire, placement silently does nothing.  
**Fallback:** Add a dummy `minecraft:block_placer` targeting a harmless block, then
cancel that placement too, as a workaround to trigger the event.
