const { spawnSync } = require('child_process');
const os = require('os');

const archs = process.argv.slice(2);
const targetArchs = archs.length > 0 ? archs : ['x64', 'arm64'];
const maxAttempts = 3;

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    },
    ...options,
  });

  return typeof result.status === 'number' ? result.status : 1;
};

const sleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const isTemporaryDmg = (imagePath) => {
  const tmpDir = os.tmpdir();
  return (
    imagePath.startsWith(tmpDir) ||
    imagePath.startsWith(`/private${tmpDir}`) ||
    imagePath.includes('/T/t-')
  );
};

const cleanupTemporaryDiskImages = () => {
  spawnSync('hdiutil', ['detach', '-force', '/Volumes/DotDo Installer'], { stdio: 'ignore' });

  const info = spawnSync('hdiutil', ['info'], { encoding: 'utf8' });
  if (info.status !== 0 || !info.stdout) {
    return;
  }

  info.stdout.split('================================================').forEach((block) => {
    const imagePath = block.match(/image-path\s+:\s+(.+)/)?.[1]?.trim();
    const device = block.match(/^(\/dev\/disk\d+)/m)?.[1];

    if (!imagePath || !device || !isTemporaryDmg(imagePath)) {
      return;
    }

    spawnSync('hdiutil', ['detach', '-force', device], { stdio: 'ignore' });
  });
};

for (const arch of targetArchs) {
  let built = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    cleanupTemporaryDiskImages();
    console.log(`Building macOS ${arch} DMG, attempt ${attempt}/${maxAttempts}`);

    const status = run('npx', ['electron-builder', '--mac', 'dmg', `--${arch}`, '--publish', 'never']);
    if (status === 0) {
      built = true;
      break;
    }

    cleanupTemporaryDiskImages();
    if (attempt < maxAttempts) {
      sleep(attempt * 2000);
    }
  }

  if (!built) {
    console.error(`Failed to build macOS ${arch} DMG after ${maxAttempts} attempts.`);
    process.exit(1);
  }
}
