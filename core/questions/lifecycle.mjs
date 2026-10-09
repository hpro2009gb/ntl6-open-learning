const ALLOWED = Object.freeze({
  NONE:new Set(['GENERATED_CANDIDATE']),
  GENERATED_CANDIDATE:new Set(['VALIDATED','RETIRED']),
  VALIDATED:new Set(['PROMOTED','RETIRED']),
  PROMOTED:new Set(['RETIRED']),
  RETIRED:new Set()
});

export function canTransitionQuestion(previousState,newState) {
  return Boolean(ALLOWED[previousState]?.has(newState));
}

export function assertQuestionTransition(previousState,newState) {
  if (!canTransitionQuestion(previousState,newState)) {
    throw new Error(`ILLEGAL_QUESTION_TRANSITION:${previousState}->${newState}`);
  }
  return { previous_state:previousState,new_state:newState };
}

export function currentQuestionState(events,itemId) {
  const rows=(events??[]).filter((e)=>e.item_id===itemId);
  let state='NONE';
  for (const row of rows) {
    if (row.previous_state!==state) throw new Error(`QUESTION_HISTORY_CONFLICT:${itemId}:${state}->${row.previous_state}`);
    assertQuestionTransition(row.previous_state,row.new_state);
    state=row.new_state;
  }
  return state;
}
