import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const publicDir = path.join(projectRoot, 'public');
export const viewsDir = path.join(projectRoot, 'src', 'views');
export const noPreviewImagePath = path.join(publicDir, 'assets', 'noPreview.svg');
export const defaultAvatarPath = path.join(publicDir, 'assets', 'avatar.svg');
