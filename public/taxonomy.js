export const COUNTRY_NAMES = Object.freeze({
  GB: "UK", IE: "Ireland", CA: "Canada", AU: "Australia", US: "United States", SG: "Singapore",
  DE: "Germany", NL: "Netherlands", CH: "Switzerland", SE: "Sweden", DK: "Denmark", NO: "Norway",
  ES: "Spain", PT: "Portugal", EE: "Estonia", NZ: "New Zealand", FR: "France", IT: "Italy",
  PL: "Poland", BE: "Belgium", FI: "Finland", AT: "Austria", JP: "Japan", KR: "South Korea",
  IN: "India", TW: "Taiwan"
});

export const COUNTRY_FLAGS = Object.freeze({
  GB: "🇬🇧", IE: "🇮🇪", CA: "🇨🇦", AU: "🇦🇺", US: "🇺🇸", SG: "🇸🇬", DE: "🇩🇪", NL: "🇳🇱",
  CH: "🇨🇭", SE: "🇸🇪", DK: "🇩🇰", NO: "🇳🇴", ES: "🇪🇸", PT: "🇵🇹", EE: "🇪🇪", NZ: "🇳🇿",
  FR: "🇫🇷", IT: "🇮🇹", PL: "🇵🇱", BE: "🇧🇪", FI: "🇫🇮", AT: "🇦🇹", JP: "🇯🇵", KR: "🇰🇷",
  IN: "🇮🇳", TW: "🇹🇼"
});

export const ROLE_FAMILY_NAMES = Object.freeze([
  "Engineering", "Product", "Design", "Data/Analytics", "Security/IT", "Sales", "Marketing",
  "Finance", "Operations", "Customer Success/Support", "People/HR", "Legal/Compliance",
  "Strategy/Program", "Other"
]);

export const SENIORITY_NAMES = Object.freeze([
  "Executive", "Director/Head", "Senior/Lead", "Manager", "Associate/Analyst", "Unknown"
]);

export const VISA_SCORES = Object.freeze({ Strong: 100, Likely: 75, Unknown: 50 });
export const SENIORITY_SCORES = Object.freeze({
  Executive: 95, "Director/Head": 90, "Senior/Lead": 85, Manager: 80, "Associate/Analyst": 70, Unknown: 65
});
export const SCORE_WEIGHTS = Object.freeze({ visa: 0.5, seniority: 0.3, freshness: 0.2 });

export function scoreJob({ visa = "Unknown", seniority = "Unknown", freshness = 80 }) {
  return Math.round(
    (VISA_SCORES[visa] || VISA_SCORES.Unknown) * SCORE_WEIGHTS.visa
    + (SENIORITY_SCORES[seniority] || SENIORITY_SCORES.Unknown) * SCORE_WEIGHTS.seniority
    + freshness * SCORE_WEIGHTS.freshness
  );
}
