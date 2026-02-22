# Server Guide Images

Place images here with filenames matching the embed IDs in `src/config/server-guide.json`.

## Expected filenames:
- `welcome.png` (or .jpg, .webp)
- `founder-message.png`
- `rules.png`
- `getting-started.png`
- `channel-guide.png`
- `community-labs.png`
- `server-ideas.png`
- `bot-features.png`
- `progression-roles.png`
- `interest-roles.png`
- `stay-connected.png`

## How it works:
1. Drop your images here with the correct filename
2. Run `/server-guide post` - the bot will upload images to the configured upload channel
3. The URLs are cached so images don't need to be re-uploaded every time
4. If an image is missing, the embed posts without an image

## Recommended specs:
- Format: PNG or WebP
- Aspect ratio: 16:9
- Max width: 1920px (Discord will resize larger images)
