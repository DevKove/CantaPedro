import { createHash } from "node:crypto";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const soundFontUrl = "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2";
const expectedSha256 = "9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe";
const soundFontPath = resolve(root, "assets/GeneralUser-GS.sf2");
const processorPath = resolve(root, "node_modules/spessasynth_lib/dist/spessasynth_processor.min.js");

await mkdir(resolve(root, "assets"), { recursive: true });
await mkdir(resolve(root, "vendor"), { recursive: true });

let soundFont;
try {
  soundFont = await readFile(soundFontPath);
} catch {
  console.log("Baixando SoundFont GeneralUser GS para incluir no instalador offline...");
  const response = await fetch(soundFontUrl);
  if (!response.ok) throw new Error(`Download do SoundFont falhou: HTTP ${response.status}`);
  soundFont = Buffer.from(await response.arrayBuffer());
  await writeFile(soundFontPath, soundFont);
}
const actualSha256 = createHash("sha256").update(soundFont).digest("hex");
if (actualSha256 !== expectedSha256) throw new Error("SHA-256 do SoundFont inválido. O arquivo não será empacotado.");

await copyFile(processorPath, resolve(root, "vendor/spessasynth_processor.min.js"));
await build({
  entryPoints: [resolve(root, "audio-engine.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outfile: resolve(root, "vendor/midi-engine.js"),
  minify: true
});
console.log("Motor SoundFont e banco GM verificados e preparados para uso offline.");
