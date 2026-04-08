export const getDealScoreColor = (score: number): string => {
  if (score >= 80) return 'bg-green-500 text-white';
  if (score >= 65) return 'bg-yellow-400 text-gray-900';
  if (score >= 50) return 'bg-orange-400 text-white';
  return 'bg-gray-400 text-white';
};

export const getDealScoreBorderColor = (score: number): string => {
  if (score >= 80) return 'border-green-500';
  if (score >= 65) return 'border-yellow-400';
  if (score >= 50) return 'border-orange-400';
  return 'border-gray-300';
};

export const getDealScoreLabel = (score: number): string => {
  if (score >= 80) return 'Hot Deal';
  if (score >= 65) return 'Good Deal';
  if (score >= 50) return 'Fair';
  return 'Below Avg';
};

export const getDealScoreTextColor = (score: number): string => {
  if (score >= 80) return 'text-green-600';
  if (score >= 65) return 'text-yellow-600';
  if (score >= 50) return 'text-orange-500';
  return 'text-gray-500';
};
