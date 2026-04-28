#!/usr/bin/env node
import { Command } from "commander"
import { ZodError } from "zod"
import { auth } from "./cmd/auth.js"
import { register_chat } from "./cmd/chat.js"
import { register_gpt_image_2 } from "./cmd/generate/gpt_image_2.js"
import { register_nano_banana_2 } from "./cmd/generate/nano_banana_2.js"
import { register_nano_banana_pro } from "./cmd/generate/nano_banana_pro.js"
import { register_seedance_2 } from "./cmd/generate/seedance_2.js"
import { register_seedream_4_5 } from "./cmd/generate/seedream_4_5.js"
import { register_seedream_5 } from "./cmd/generate/seedream_5.js"
import { logout } from "./cmd/logout.js"
import { models } from "./cmd/models.js"
import { register_resume } from "./cmd/resume.js"
import { whoami } from "./cmd/whoami.js"

const version = "0.1.3"

const help_after = `
vhscli is a command-line tool that talks to ai models in the cloud to make
images, videos, and text replies. log in once with google; no api key needed.

examples:
  vhscli login
  vhscli models
  vhscli generate seedream-5 "a corgi astronaut riding a bicycle on mars"
  vhscli generate seedance-2 "a robot dancing in tokyo at night, slow tracking shot"
  vhscli chat "summarize this paper in 5 bullets; include page numbers." -f paper.pdf
  cat prompt.txt | vhscli generate gpt-image-2 -`

const program = new Command()
  .name("vhscli")
  .description("generate images and videos with ai")
  .version(version, "-v, --version", "print version")
  .helpOption("-h, --help", "show help")
  .enablePositionalOptions()
  .showSuggestionAfterError(true)
  .showHelpAfterError("(run 'vhscli --help' for usage, or 'vhscli generate --help' to list models)")
  .addHelpText("after", help_after)

program.command("login")
  .description("log in with google (opens browser)")
  .action(auth)

program.command("logout")
  .description("log out and delete local access tokens")
  .action(logout)

program.command("whoami")
  .description("show the logged-in user")
  .action(whoami)

program.command("models")
  .description("list available models")
  .action(models)

const generate = program.command("generate")
  .description("generate images and videos with ai models")
  .showHelpAfterError("(run 'vhscli generate --help' to list models, or 'vhscli generate <model> --help' for model options)")
  .addHelpText("after", "\nrun 'vhscli generate <model> --help' to see options for a specific model.")
  .action(function () { this.help() })

register_seedance_2(generate)
register_seedream_5(generate)
register_seedream_4_5(generate)
register_nano_banana_2(generate)
register_nano_banana_pro(generate)
register_gpt_image_2(generate)
register_chat(program)
register_resume(program)

if (process.argv.length <= 2) program.help({ error: false })

try {
  await program.parseAsync(process.argv)
} catch (err) {
  if (err instanceof ZodError) {
    console.error("unexpected response shape")
    for (const issue of err.issues) console.error(` ${issue.path.join(".")}: ${issue.message.toLowerCase()}`)
    process.exit(1)
  }
  throw err
}
