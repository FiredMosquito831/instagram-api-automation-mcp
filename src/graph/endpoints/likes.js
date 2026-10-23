// Likes and unlikes of media or comments, through the owner's likes edge. Both are writes, so the client is called with
// no retryPost, and a failed write is reported to the caller and never repeated here.

import { IgError } from '../../errors.js';
import { optionsOf } from './common.js';
import { checkId, responseConfirmed } from './common.js';

// The parameter that names the target, by kind. Any other kind is refused.
const PARAM_OF_KIND = new Map([
  ['media', 'media_id'],
  ['comment', 'comment_id'],
]);

function likeParam(kind) {
  const param = PARAM_OF_KIND.get(kind);
  if (param === undefined) throw new IgError('VALIDATION', "kind must be 'media' or 'comment'");
  return param;
}

export async function like(client, options) {
  const { igUserId, targetId, kind } = optionsOf(options, 'like');
  checkId(igUserId, 'igUserId');
  checkId(targetId, 'targetId');
  const param = likeParam(kind);
  const { data } = await client.post(`${igUserId}/likes`, { form: { [param]: targetId } });
  responseConfirmed(data, 'like');
  return { targetId, kind, liked: true };
}

// The same parameter as like, sent as a query on a DELETE.
export async function unlike(client, options) {
  const { igUserId, targetId, kind } = optionsOf(options, 'unlike');
  checkId(igUserId, 'igUserId');
  checkId(targetId, 'targetId');
  const param = likeParam(kind);
  const { data } = await client.del(`${igUserId}/likes`, { [param]: targetId });
  responseConfirmed(data, 'unlike');
  return { targetId, kind, liked: false };
}
