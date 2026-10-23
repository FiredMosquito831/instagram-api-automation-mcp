// The owner's profile, read with GET me. A field that Graph omits is null.

import { orNull, responseId, responseObject } from './common.js';

const PROFILE_FIELDS = 'id,username,biography,website,followers_count,follows_count,media_count';

export async function profileGet(client) {
  const { data } = await client.get('me', { fields: PROFILE_FIELDS });
  const profile = responseObject(data, 'profile');
  return {
    id: responseId(profile, 'profile'),
    username: orNull(profile.username),
    biography: orNull(profile.biography),
    website: orNull(profile.website),
    followersCount: orNull(profile.followers_count),
    followsCount: orNull(profile.follows_count),
    mediaCount: orNull(profile.media_count),
  };
}
