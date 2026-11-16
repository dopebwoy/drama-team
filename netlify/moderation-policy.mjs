export function participantRole(participant) {
  try {
    const role = JSON.parse(participant.metadata || '{}').role;
    if (role === 'umukomite') return 'umukomite';
    if (role === 'umufamiliye' || role === 'member') return 'umufamiliye';
  } catch { /* Older participants have no role metadata; keep them protected. */ }

  if (participant.identity?.startsWith('manager-')) return 'umukomite';
  if (participant.identity?.startsWith('member-')) return 'umufamiliye';
  return 'unknown';
}

export function canManagerRemoveParticipant(participant) {
  return participantRole(participant) === 'umufamiliye';
}
