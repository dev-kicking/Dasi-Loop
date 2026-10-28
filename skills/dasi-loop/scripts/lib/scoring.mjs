const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const number = value => typeof value === 'number' && Number.isFinite(value);
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;

export function normalizeRubric(input, criteria) {
  if (!input || !Array.isArray(input.dimensions) || !input.dimensions.length) throw new Error('Task requires a rubric with scoring dimensions.');
  const rubric = { target: 85, plateau_rounds: 2, min_delta: 1, ...input };
  if (!number(rubric.target) || rubric.target <= 0 || rubric.target > 100 || !Number.isSafeInteger(rubric.plateau_rounds) || rubric.plateau_rounds < 1 || !number(rubric.min_delta) || rubric.min_delta <= 0 || rubric.min_delta > 100) throw new Error('Rubric requires target in (0,100], positive plateau_rounds and min_delta.');
  const ids = new Set();
  for (const dimension of rubric.dimensions) {
    if (!dimension || !nonempty(dimension.id) || ids.has(dimension.id) || !nonempty(dimension.description) || !number(dimension.weight) || dimension.weight <= 0) throw new Error('Dimensions require unique IDs, descriptions and positive weights.');
    ids.add(dimension.id);
    if (!dimension.anchors || ![0, 1, 2, 3, 4].every(rating => nonempty(dimension.anchors[rating]))) throw new Error('Each dimension requires task-specific anchors for ratings 0,1,2,3,4.');
    if (!Array.isArray(dimension.criteria) || !dimension.criteria.length || new Set(dimension.criteria).size !== dimension.criteria.length || !dimension.criteria.every(id => criteria.some(item => item.id === id))) throw new Error('Every dimension must reference known criterion IDs.');
  }
  if (Math.abs(rubric.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0) - 100) > 0.000001) throw new Error('Rubric weights must sum to 100.');
  if (criteria.some(item => item.required && !rubric.dimensions.some(dimension => dimension.criteria.includes(item.id)))) throw new Error('Every required criterion must be covered by the rubric.');
  return rubric;
}

export function scoreReview(response, task) {
  if (!Array.isArray(response.scores) || response.scores.length !== task.rubric.dimensions.length || new Set(response.scores.map(item => item?.dimension)).size !== task.rubric.dimensions.length) throw new Error('Reviewer must score every rubric dimension exactly once.');
  const dimensions = task.rubric.dimensions.map(dimension => {
    const item = response.scores.find(score => score.dimension === dimension.id);
    if (!item || !Number.isInteger(item.rating) || item.rating < 0 || item.rating > 4 || !nonempty(item.evidence) || (item.rating < 4 && !nonempty(item.improvement))) throw new Error('Scores require known dimension IDs, integer ratings 0..4, evidence, and an improvement for any rating below 4.');
    const unresolved = dimension.criteria.some(id => response.checks.find(check => check.criterion === id)?.status !== 'passed');
    if (unresolved && item.rating === 4) throw new Error('A dimension cannot receive rating 4 while a linked criterion is failed or unverified.');
    return { ...item, weight: dimension.weight, points: round(dimension.weight * item.rating / 4) };
  });
  // Sum raw weighted ratings; never trust a total supplied by an evaluator.
  const total = round(task.rubric.dimensions.reduce((sum, dimension) => sum + dimension.weight * response.scores.find(item => item.dimension === dimension.id).rating / 4, 0));
  return { total, dimensions };
}

export function scoreTrend(state) {
  let previous = null;
  const history = state.attempts.filter(attempt => attempt.review).map(attempt => {
    const { total, dimensions } = attempt.review.score;
    const result = {
      attempt: attempt.number,
      total,
      delta: previous ? round(total - previous.total) : null,
      dimensions: dimensions.map(item => ({
        id: item.dimension, rating: item.rating, points: item.points,
        delta: previous ? round(item.points - previous.dimensions.find(before => before.dimension === item.dimension).points) : null,
      })),
    };
    previous = attempt.review.score;
    return result;
  });
  const best = history.reduce((best, item) => !best || item.total > best.total ? item : best, null);
  const window = state.task.rubric.plateau_rounds;
  const priorBest = history.length > window ? Math.max(...history.slice(0, -window).map(item => item.total)) : null;
  const recentBest = history.length ? Math.max(...history.slice(-window).map(item => item.total)) : null;
  return {
    history,
    best_score: best?.total ?? null,
    best_attempt: best?.attempt ?? null,
    regression: history.length > 1 && history.at(-1).delta < 0,
    plateau: priorBest !== null && recentBest - priorBest < state.task.rubric.min_delta,
  };
}
