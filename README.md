# 🎭 Prank Chest

A Minecraft Bedrock Edition addon that adds a deceptive chest — looks identical to a normal chest, but secretly downgrades items placed inside it after one in-game hour.

## Features

- **Custom crafting recipe** — same as a normal chest + redstone dust in the center
- **Visually identical** to a regular chest — no way to tell them apart
- **Timed item downgrade** — items placed inside get swapped to lower-tier equivalents after a configurable delay (default: 1 in-game hour = 50 real seconds)
- **Affects ores, ingots, tools, and armor** — full downgrade chain for each category

## Project Structure

```
docs/           ← Design specs and ideas
src/
  behavior_pack/  ← Addon logic (scripts, blocks, recipes)
  resource_pack/  ← Textures, UI, localization
```

## Development

- **Design & specs:** see [docs/DESIGN.md](docs/DESIGN.md)
- **Target platform:** Minecraft Bedrock Edition 1.21+
- **Script API:** `@minecraft/server` v1.x

## License

MIT
