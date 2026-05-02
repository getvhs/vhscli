# vhscli

`vhscli` is a small CLI for sending image, video, and chat jobs to VHS.

The client handles auth, input uploads, task creation, polling, and writing output files. Model execution stays on the VHS service, so users do not need provider API keys on their machine.

## Quick Start

Run without installing:

```sh
npx getvhs/vhscli@latest login
npx getvhs/vhscli@latest models
npx getvhs/vhscli@latest generate seedream-5 "a corgi astronaut riding a bicycle on mars"
```

The installed binary is `vhscli`:

```sh
vhscli login
vhscli models
vhscli generate gpt-image-2 "a clean app icon for a video tool"
```

Use `-` when the prompt should come from stdin:

```sh
cat prompt.txt | vhscli generate gpt-image-2 -
cat question.txt | vhscli chat - -f paper.pdf
```

## Requirements

- Node.js `22` or newer
- `file` for MIME detection before upload
- `sips` for local image conversion on macOS
- `ffmpeg` when the requested video output format differs from the source

## Auth

```sh
vhscli login
vhscli whoami
vhscli logout
```

`login` opens the browser, listens for the OAuth callback locally, and writes the session to `~/.vhs/session.json`.

`whoami` prints the session email, falling back to the user id.

`logout` deletes the local session file.

Commands that need auth will start login if no valid session exists.

## Commands

### `vhscli models`

Prints the model aliases known to the CLI.

### `vhscli generate`

`generate` is a command group. Use help to list model subcommands:

```sh
vhscli generate --help
```

Ask a model subcommand for its exact flags:

```sh
vhscli generate gpt-image-2 --help
```

Generation commands print a `task_id` before waiting for output. Keep it; it is the durable handle for resume.

### `vhscli resume <task_id>`

Reads the result for an existing generation task.

```sh
vhscli resume 8f3a1b2c-9e0f-4a1b-9c8d-1e2f3a4b5c6d
vhscli resume 8f3a1b2c-9e0f-4a1b-9c8d-1e2f3a4b5c6d -o out.mp4
```

The server job keeps running after the local process exits. `resume` attaches the CLI back to that task and writes the result when it is ready.

### `vhscli chat <prompt>`

Runs one chat request and writes the answer to stdout. It does not create an output file.

```sh
vhscli chat "explain how to make sourdough in 5 steps"
vhscli chat "describe this image as json" -i photo.jpg
vhscli chat "summarize this paper in 5 bullets; include page numbers" -f paper.pdf
vhscli chat "list key events with HH:mm:ss timestamps" -v clip.mp4 --fps 2
```

Options:

- `-i, --image <path>` attaches an image. Repeat for multiple images.
- `-f, --file <path>` attaches a PDF. Repeat for multiple files.
- `-v, --video <path>` attaches one video.
- `--fps <n>` samples video from `0.2` to `5` frames per second. Default is `1`.

## Image Models

### `seedream-5`

Seedream 5.0 image generation and editing.

```sh
vhscli generate seedream-5 "a girl in a yellow raincoat walking under a parasol, monet oil painting style"
vhscli generate seedream-5 "remove her hat, keep everything else" -i photo.jpg
```

Options:

- `-o, --output <path>` sets the output path.
- `-i, --image <path>` adds a reference image. Maximum `14`; repeat for more.
- `--size <size>` accepts `2K`, `3K`, or custom `WxH`.

Custom sizes must pass the model pixel range and aspect ratio checks enforced by the CLI.

### `seedream-4-5`

Seedream 4.5 image generation and editing.

```sh
vhscli generate seedream-4-5 "an open refrigerator with milk, eggs, leftover chicken, strawberries; warm light"
vhscli generate seedream-4-5 "swap the dress to red, keep her pose unchanged" -i photo.jpg
```

Options:

- `-o, --output <path>` sets the output path.
- `-i, --image <path>` adds a reference image. Maximum `14`; repeat for more.
- `--size <size>` accepts `2K`, `4K`, or custom `WxH`.

### `nano-banana-2`

Nano Banana 2 image generation and editing.

```sh
vhscli generate nano-banana-2 "remove the man from the photo, keep everything else" -i photo.jpg
vhscli generate nano-banana-2 "current weather in san francisco shown as a tiny city-in-a-cup" --search
```

Options:

- `-o, --output <path>` sets the output path.
- `-i, --image <path>` adds a reference image. Maximum `14`; repeat for more.
- `--ratio <ratio>` sets aspect ratio.
- `--size <size>` accepts `512`, `1K`, `2K`, or `4K`.
- `--think <level>` accepts `minimal` or `high`.
- `--search` enables Google web search.
- `--image-search` enables Google image search and also enables web search.

Supported ratios are `1:1`, `1:4`, `1:8`, `2:3`, `3:2`, `3:4`, `4:1`, `4:3`, `4:5`, `5:4`, `8:1`, `9:16`, `16:9`, and `21:9`.

### `nano-banana-pro`

Nano Banana Pro image generation and editing.

```sh
vhscli generate nano-banana-pro "a glossy face moisturizer jar on warm studio backdrop"
vhscli generate nano-banana-pro "a sun-drenched minimalist living room with a 3d armchair from this sketch" -i sketch.jpg
```

Options:

- `-o, --output <path>` sets the output path.
- `-i, --image <path>` adds a reference image. Maximum `14`; repeat for more.
- `--ratio <ratio>` sets aspect ratio.
- `--size <size>` accepts `1K`, `2K`, or `4K`.

Supported ratios are `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, and `21:9`.

### `gpt-image-2`

OpenAI `gpt-image-2` image generation and editing.

```sh
vhscli generate gpt-image-2 "a children's book drawing of a veterinarian examining a cat"
vhscli generate gpt-image-2 "replace the background with a starry night" -i photo.jpg
vhscli generate gpt-image-2 "add a red balloon in the masked area" -i room.png --mask mask.png
```

Options:

- `-o, --output <path>` sets the output path.
- `-i, --image <path>` adds a reference image. Repeat for more.
- `--mask <path>` adds an edit mask. It requires `-i`.
- `--size <size>` accepts a preset or custom `WxH`.

Size presets are `auto`, `1024x1024`, `1536x1024`, `1024x1536`, `2048x2048`, `2048x1152`, and `3840x2160`.

Custom sizes must use multiples of `16`, max edge `3840`, total pixels from `655360` to `8294400`, and aspect ratio from `1:3` to `3:1`.

The output extension selects the local format: `png`, `jpg`, `jpeg`, or `webp`. Without `-o`, the format is `png`.

## Video Model

### `seedance-2`

Seedance 2.0 video generation.

```sh
vhscli generate seedance-2 "a woman in a red dress walks through a rainy neon-lit alley, slow tracking shot"
vhscli generate seedance-2 "animate this photo: gentle pan to the right" --first-frame photo.jpg
vhscli generate seedance-2 "match the camera move from this clip in a cyberpunk street" -v ref.mp4
```

Options:

- `-o, --output <path>` sets the output path.
- `--first-frame <image>` uses an image as the first frame.
- `--last-frame <image>` uses an image as the last frame. It requires `--first-frame`.
- `-i, --image <path>` adds a reference image. Maximum `9`. Conflicts with `--first-frame`.
- `-v, --video <path>` adds a reference video. Maximum `3`; repeat for more.
- `-a, --audio <path>` adds a reference audio file. Maximum `3`. Requires at least one `-i` or `-v`.
- `--ratio <ratio>` accepts `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, or `adaptive`.
- `--resolution <res>` accepts `480p`, `720p`, or `1080p`.
- `--duration <n>` accepts `4` to `15`, or `-1` for auto. Default is `5`.
- `--silent` disables audio generation.
- `--seed <n>` sets a random seed.

The command polls until the result is ready and prints progress dots. If the process stops, use `vhscli resume <task_id>`.

## Files And Output

Generated assets default to:

```txt
vhscli-<model>-<timestamp>.<ext>
```

Use `-o` to choose the path.

Downloads are written through a temporary file and renamed into place. If the requested extension does not match the downloaded media type, conversion happens locally:

- images use `sips`
- videos use `ffmpeg`

Input uploads use content hashes for remote object paths. A duplicate upload is treated as success, not failure.

Image type is detected from file content. JPEG and PNG are uploaded as-is; other image formats are converted to JPEG first.

## Project Structure

```txt
main.ts
cmd/
  chat.ts
  login.ts
  logout.ts
  models.ts
  resume.ts
  session.ts
  whoami.ts
  generate/
    gpt_image_2.ts
    nano_banana_2.ts
    nano_banana_pro.ts
    seedance_2.ts
    seedream_4_5.ts
    seedream_5.ts
lib/
  error.ts
  media.ts
  process.ts
  prompt.ts
  session.ts
  submit.ts
  supabase.ts
  t3.ts
  util.ts
  schema/
```

Command code lives in `cmd/`. Shared runtime code lives in `lib/`. Model schemas are split out so commands can import short names like `schema.request` and `schema.response`.

## Core Flow

Generation and chat share the same server handoff:

1. Parse and validate CLI inputs.
2. Upload local media to Supabase Storage.
3. Build the provider payload and validate it against the model schema.
4. Create a `task2` row in Supabase PostgREST with:
   - `id`: a generated task id
   - `user_id`: the current session user id
   - `endpoint`: the server provider route, such as `openai:image_generations`
   - `payload`: the validated request payload
5. Submit the task to `/functions/v1/main2/submit` with `{ task_id }`.
6. Read `task2.result` or `task2.err`.
7. Validate the result shape and save or print the output.

The CLI never calls model providers directly. The `task2` row is the durable job record; `/submit` is the server entry point for model execution.

Long jobs can finish after the local process exits. `vhscli resume <task_id>` reads the same `task2` row, waits for `result` or `err`, and saves output through the endpoint-specific result parser.

## Design Decisions

The runtime is stock Node and TypeScript. There is no Bun dependency and no local workspace package assumption.

The package is ESM-only and targets modern Node. That keeps the runtime model simple and matches current npm behavior.

`commander` owns command parsing, help text, and option validation.

`zod` validates request payloads before they are written to `task2`, then validates service responses before output is saved.

The CLI is intentionally thin: upload bytes, create a task row, call `/submit`, wait, and save the result. Provider-specific execution remains server-side.

Errors are not hidden. Expected user errors call `die()`, print a short lowercase message, and exit with status `1`. Unexpected errors are allowed to throw.

Auth state stays in `~/.vhs/session.json` so this package can share existing VHS sessions.

