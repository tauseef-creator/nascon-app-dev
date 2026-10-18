// Plain-language helpers for the FR-1.3 match status state machine.
import { Icon } from '../components/Icon';
import React from 'react';
import { Match, MatchStatus } from '../api/types';
import { colors } from '../theme';

type IconName = React.ComponentProps<typeof Icon>['name'];

/** Statuses that freeze a match: the server rejects new score events. */
export const FROZEN_STATUSES: MatchStatus[] = ['postponed', 'abandoned', 'cancelled'];
export const isFrozen = (s: MatchStatus | null | undefined) => !!s && FROZEN_STATUSES.includes(s);

/** Matches that are over (shown under Results). */
export const isFinished = (s: MatchStatus) => s === 'completed' || s === 'abandoned' || s === 'cancelled';
/** Matches still to be played (shown under Upcoming). */
export const isPending = (s: MatchStatus) => s === 'upcoming' || s === 'postponed';

export const STATUS_LABEL: Record<string, string> = {
  upcoming: 'Upcoming',
  in_progress: 'Live',
  completed: 'Full time',
  postponed: 'Postponed',
  abandoned: 'Abandoned',
  cancelled: 'Cancelled',
};

export const statusLabel = (s: MatchStatus | null | undefined) => (s ? STATUS_LABEL[s] ?? 'Upcoming' : 'Upcoming');

/** Icon and colour for the off-schedule statuses (always shown together with the label). */
export const OFF_SCHEDULE: Record<string, { icon: IconName; color: string }> = {
  postponed: { icon: 'pause-circle', color: colors.warning },
  abandoned: { icon: 'alert-circle', color: colors.danger },
  cancelled: { icon: 'ban', color: colors.textMuted },
};

/** One sentence explaining a frozen match to every user. */
export function frozenMessage(s: MatchStatus): string {
  if (s === 'postponed') return 'This match is postponed. Scoring is paused.';
  if (s === 'abandoned') return 'This match was abandoned. Scoring is closed.';
  if (s === 'cancelled') return 'This match was cancelled. Scoring is closed.';
  return '';
}

export const involves = (m: Match, clubId: string) => m.home_team_id === clubId || m.away_team_id === clubId;
export const byTime = (a: Match, b: Match) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-01-01" -> "1 Jan 2026" (date-only strings, no time zone shift). */
export function formatDay(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? '');
  if (!m) return ymd ?? '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}
