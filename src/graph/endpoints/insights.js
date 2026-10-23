// Insights reads. The metric names come only from INSIGHT_METRICS, the allowlist kept here. A metric or period that is
// not listed is refused before any request. impressions is not listed: the metric is deprecated for all versions.

import { IgError } from '../../errors.js';
import { optionsOf } from './common.js';
import { checkId, orNull, responseObject } from './common.js';

// Account and media metrics from the Graph notes in research_notes. Left out, as deprecated or not verified for this
// project: impressions, plays, clips_replays_count and ig_reels_aggregated_all_plays_count (deprecated); total_comments,
// total_likes, total_views and link_clicks (Facebook Login only in the notes); profile_views (not in the metric list).
export const INSIGHT_METRICS = Object.freeze([
  'accounts_engaged',
  'comments',
  'crossposted_views',
  'engaged_audience_demographics',
  'follower_count',
  'follower_demographics',
  'follows',
  'follows_and_unfollows',
  'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
  'likes',
  'navigation',
  'online_followers',
  'profile_activity',
  'profile_links_taps',
  'profile_visits',
  'reach',
  'reels_skip_rate',
  'replies',
  'reposts',
  'saved',
  'saves',
  'shares',
  'total_interactions',
  'views',
]);
const ALLOWED = new Set(INSIGHT_METRICS);
export const PERIODS = Object.freeze(['day', 'lifetime']);

// Every metric must be a string on the allowlist, named once. The result is the comma-joined list for the query.
function checkMetrics(metrics) {
  if (!Array.isArray(metrics) || metrics.length === 0) {
    throw new IgError('VALIDATION', 'metrics must be a non-empty list of metric names');
  }
  const seen = new Set();
  for (const metric of metrics) {
    if (typeof metric !== 'string') throw new IgError('VALIDATION', 'each metric must be a string');
    if (!ALLOWED.has(metric)) throw new IgError('VALIDATION', `metric ${metric} is not on the allowlist`);
    if (seen.has(metric)) throw new IgError('VALIDATION', `metric ${metric} is listed more than once`);
    seen.add(metric);
  }
  return metrics.join(',');
}

function normaliseMetric(raw) {
  const metric = responseObject(raw, 'insight');
  if (typeof metric.name !== 'string' || metric.name === '' || !Array.isArray(metric.values)) {
    throw new IgError('API_ERROR', 'Graph API insight has no name or values');
  }
  return {
    name: metric.name,
    period: orNull(metric.period),
    values: metric.values.map((entry) => {
      const value = responseObject(entry, 'insight value');
      return { value: orNull(value.value), endTime: orNull(value.end_time) };
    }),
  };
}

function normaliseInsights(data) {
  const body = responseObject(data, 'insights');
  if (!Array.isArray(body.data)) throw new IgError('API_ERROR', 'Graph API insights response has no data array');
  return { metrics: body.data.map(normaliseMetric) };
}

export async function accountInsights(client, options) {
  const { igUserId, metrics, period = 'day' } = optionsOf(options, 'accountInsights');
  checkId(igUserId, 'igUserId');
  const metric = checkMetrics(metrics);
  if (!PERIODS.includes(period)) throw new IgError('VALIDATION', 'period must be day or lifetime');
  const { data } = await client.get(`${igUserId}/insights`, { metric, period });
  return normaliseInsights(data);
}

export async function mediaInsights(client, options) {
  const { mediaId, metrics } = optionsOf(options, 'mediaInsights');
  checkId(mediaId, 'mediaId');
  const metric = checkMetrics(metrics);
  const { data } = await client.get(`${mediaId}/insights`, { metric });
  return normaliseInsights(data);
}
