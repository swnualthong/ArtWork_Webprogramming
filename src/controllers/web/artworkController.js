import { setFlash } from '../../middleware/flash.js';
import * as artworkQueries from '../../services/artworkQueries.js';
import { artworkFileLimits } from '../../services/fileTypes.js';
import { notFound } from '../../utils/httpErrors.js';
import * as artworkOperations from '../shared/artworkOperations.js';
import * as engagementOperations from '../shared/engagementOperations.js';

export async function newForm(_req, res) {
  res.render('app/artworkForm', { artwork: null, artworkFileLimits, tagSuggestions: await artworkQueries.listTagSuggestions() });
}

export async function create(req, res) {
  const artwork = await artworkOperations.createArtwork(req, res);
  setFlash(req, 'success', artwork.previewSource === 'placeholder' ? 'Created (no preview image)' : 'Created');
  res.redirect(303, `/app/artworks/${artwork.artworkId}`);
}

export async function editForm(req, res) {
  const artwork = await artworkQueries.getArtworkDetail(req.validated.params.artworkId);
  if (!artwork) {
    throw notFound('ไม่พบงานนี้');
  }
  res.render('app/artworkForm', { artwork, artworkFileLimits, tagSuggestions: await artworkQueries.listTagSuggestions() });
}

export async function update(req, res) {
  const artwork = await artworkOperations.updateArtwork(req, res);
  setFlash(req, 'success', 'Saved');
  res.redirect(303, `/app/artworks/${artwork.artworkId}`);
}

export async function destroy(req, res) {
  await artworkOperations.deleteArtwork(req, res);
  setFlash(req, 'success', 'Deleted');
  res.redirect(303, '/app/profile#works');
}

export async function addComment(req, res) {
  await engagementOperations.addComment(req, res);
  res.redirect(303, `/app/artworks/${req.validated.params.artworkId}#comments`);
}

export async function deleteComment(req, res) {
  const { artworkId } = await engagementOperations.deleteComment(req, res);
  setFlash(req, 'success', 'Comment deleted');
  res.redirect(303, `/app/artworks/${artworkId}#comments`);
}

export async function toggleLike(req, res) {
  await engagementOperations.toggleLike(req, res);
  res.redirect(303, `/app/artworks/${req.validated.params.artworkId}`);
}
