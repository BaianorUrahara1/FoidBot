function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const SCORE_STEPS = [
  0,
  2,
  3,
  3.25,
  3.5,
  3.75,
  4,
  4.25,
  4.5,
  4.75,
  5,
  5.25,
  5.5,
  5.75,
  6,
  6.25,
  6.5,
  6.75,
  7,
  7.25,
  7.5,
  7.75,
  8,
  8.25,
  8.5,
  8.75
];

const BASE_MESSAGES_PER_STEP = 220;
const STEP_GROWTH_FACTOR = 1.16;

function messagesRequiredForStep(stepIndex) {
  if (stepIndex <= 0) {
    return 0;
  }
  return Math.max(
    1,
    Math.round(BASE_MESSAGES_PER_STEP * Math.pow(STEP_GROWTH_FACTOR, stepIndex - 1))
  );
}

function thresholdForIndex(index) {
  let total = 0;
  for (let step = 1; step <= index; step += 1) {
    total += messagesRequiredForStep(step);
  }
  return total;
}

function rankLabelFromScore(score) {
  if (score < 4) {
    return "Subhuman";
  }

  const bands = [
    { base: 4, name: "Low Tier Normie" },
    { base: 5, name: "Mid Tier Normie" },
    { base: 6, name: "High Tier Normie" },
    { base: 7, name: "Chadlite" },
    { base: 8, name: "Chad" }
  ];

  for (const band of bands) {
    if (score >= band.base && score < band.base + 1) {
      if (score < band.base + 0.25) {
        return `${band.name} (Low)`;
      }
      if (score < band.base + 0.75) {
        return `${band.name} (Mid)`;
      }
      return `${band.name} (High)`;
    }
  }

  return "Chad (High)";
}

function resolveRatingProgress(messageCountRaw) {
  const messageCount = Math.max(0, Number(messageCountRaw) || 0);
  let index = 0;

  for (let nextIndex = 1; nextIndex < SCORE_STEPS.length; nextIndex += 1) {
    if (messageCount >= thresholdForIndex(nextIndex)) {
      index = nextIndex;
      continue;
    }
    break;
  }

  const score = SCORE_STEPS[index];
  const nextIndex = index + 1;
  const isMax = nextIndex >= SCORE_STEPS.length;
  const currentThreshold = thresholdForIndex(index);
  const nextThreshold = isMax ? null : thresholdForIndex(nextIndex);
  const messagesToNext = isMax ? 0 : Math.max(0, (nextThreshold || 0) - messageCount);

  return {
    index,
    score: clamp(score, 0, 8.75),
    rankLabel: rankLabelFromScore(score),
    currentThreshold,
    nextThreshold,
    messagesToNext,
    isMax
  };
}

module.exports = {
  SCORE_STEPS,
  rankLabelFromScore,
  resolveRatingProgress
};
