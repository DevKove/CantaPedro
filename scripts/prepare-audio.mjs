import { createHash } from "node:crypto";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const soundFontUrl = "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2";
const expectedSha256 = "9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe";
const soundFontPath = resolve(root, "assets/GeneralUser-GS.sf2");
const processorPath = resolve(root, "node_modules/spessasynth_lib/dist/spessasynth_processor.min.js");

const verifySoundFont = data => {
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`Integridade do SoundFont inválida (SHA-256: ${actual}). O arquivo foi rejeitado.`);
  }
  return data;
};

async function loadSoundFont() {
  try {
    return verifySoundFont(await readFile(soundFontPath));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  console.log("Baixando SoundFont GeneralUser GS para incluir no instalador offline...");
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(soundFontUrl, { signal: AbortSignal.timeout(90000) });
      if (!response.ok) throw new Error(`Download do SoundFont falhou: HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length < 1024 || data.length > 64 * 1024 * 1024) {
        throw new Error("Tamanho inesperado do SoundFont; arquivo rejeitado.");
      }
      verifySoundFont(data);
      await writeFile(soundFontPath, data);
      return data;
    } catch (error) {
      lastError = error;
      if (String(error.message).includes("SHA-256") || String(error.message).includes("Tamanho inesperado")) throw error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    }
  }
  throw new Error(`Não foi possível obter o SoundFont após 3 tentativas: ${lastError?.message || "erro desconhecido"}`);
}

await mkdir(resolve(root, "assets"), { recursive: true });
await mkdir(resolve(root, "vendor"), { recursive: true });
await loadSoundFont();
await copyFile(processorPath, resolve(root, "vendor/spessasynth_processor.min.js"));
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
await writeFile(resolve(root, "vendor/app-version.js"), `export const appVersion = ${JSON.stringify(packageJson.version)};` + String.fromCharCode(10));
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
