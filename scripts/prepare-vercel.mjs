import { mkdir, rm, cp, access } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const publicDir = path.join(projectRoot, 'public');
const webSourceDir = path.join(projectRoot, 'src', 'web', 'public');
const mediaRoot = path.join(publicDir, 'media');
const actionRoot = path.join(mediaRoot, 'action');
const userFilesRoot = path.join(projectRoot, 'files by user');

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(src, dest) {
  if (!(await exists(src))) {
    return false;
  }

  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest);
  return true;
}

async function main() {
  await rm(publicDir, { recursive: true, force: true });
  await mkdir(publicDir, { recursive: true });

  await cp(webSourceDir, path.join(publicDir, 'app'), { recursive: true });

  const idleSrc = path.join(userFilesRoot, 'HI', 'IMG_9732.MP4');
  const reactionSrc = path.join(userFilesRoot, 'HI', 'REACTION.mp4');
  const idleCopied = await copyIfExists(idleSrc, path.join(mediaRoot, 'idle.mp4'));
  const reactionCopied = await copyIfExists(reactionSrc, path.join(mediaRoot, 'reaction.mp4'));

  if (!reactionCopied && idleCopied) {
    await cp(path.join(mediaRoot, 'idle.mp4'), path.join(mediaRoot, 'reaction.mp4'));
  }

  const actionMap = [
    ['dance', path.join(userFilesRoot, 'dance', 'IMG_9741.MP4')],
    ['jump', path.join(userFilesRoot, 'jump', 'IMG_9737.MP4')],
    ['winner', path.join(userFilesRoot, 'happy winner', 'IMG_9740.MP4')],
    ['balalaika', path.join(userFilesRoot, 'plays the balalaika', 'IMG_9739.MP4')],
    ['sleep', path.join(userFilesRoot, 'sleeping', 'IMG_9742.MP4')],
    ['gamepad', path.join(userFilesRoot, 'playing on gamepad', 'IMG_9738.MP4')],
  ];

  await mkdir(actionRoot, { recursive: true });
  for (const [id, src] of actionMap) {
    await copyIfExists(src, path.join(actionRoot, `${id}.mp4`));
  }

  const whatIsRitualSrc = path.join(userFilesRoot, 'what is ritual', 'ritual-chain.svg');
  await copyIfExists(whatIsRitualSrc, path.join(mediaRoot, 'what-is-ritual.svg'));

  console.log('Prepared Vercel public directory.');
}

await main();
