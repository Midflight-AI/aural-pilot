type Row = Record<string, unknown>;
const object = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
/** Only committed database metadata participates in this revision. Playback URLs
 * are fetched separately; storage discovery must not silently change a snapshot. */
export function sessionSnapshot(session: Row) {
  const interview = object(Array.isArray(session.interview) ? session.interview[0] : session.interview);
  const messages = (Array.isArray(session.messages) ? session.messages : []).map(object).map(m => ({ id:m.id, role:m.role, content:m.content, timestamp:m.timestamp }));
  const recordings = new Set((Array.isArray(session.audioRecordings) ? session.audioRecordings : []).map(object).map(r => r.url).concat(session.audioRecordingUrl).filter(u => typeof u === 'string' && u.trim()));
  const completed = session.status === 'COMPLETED';
  const summary = typeof session.summary === 'string' && session.summary.trim() ? session.summary : null;
  const transcript = messages.some(m => typeof m.role === 'string' && ['user','candidate','participant'].includes(m.role.toLowerCase()) && typeof m.content === 'string' && m.content.trim());
  return {
    schema_version: '1', id:session.id, session_revision:session.sync_revision, status:session.status,
    interview:{id:interview.id, title:interview.title},
    readiness:{report:summary ? 'ready' : completed ? 'processing' : 'pending', transcript:transcript ? 'available' : completed ? 'missing' : 'pending', recording:recordings.size ? 'registered' : completed ? 'missing' : 'pending'},
    report:{session_revision:session.sync_revision, summary, insights:session.insights, themes:session.themes, sentiment:session.sentiment, totalDurationSeconds:session.totalDurationSeconds, messages, audioCount:recordings.size},
  };
}
