import * as esbuild from 'esbuild';
import { chmod } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function build() {
  await esbuild.build({
    entryPoints: [join(__dirname, 'start-remote-server.ts')],
    bundle: true,
    minify: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outfile: 'bin/remote-server.mjs',
    banner: {
      js: "#!/usr/bin/env node\nimport { createRequire } from 'module';const require = createRequire(import.meta.url);"
    },
    external: ['util'],
  });

  // Make the output file executable
  await chmod('./bin/remote-server.mjs', 0o755);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

