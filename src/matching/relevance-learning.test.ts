import { learnRelevanceTerms } from "./relevance-learning";

const learned = learnRelevanceTerms([
  { label: "relevant", text: "Occupied school interior renovation drywall painting" },
  { label: "relevant", text: "School fit out painting and flooring" },
  { label: "not_relevant", text: "Highway bridge structural engineering" }
]);
if (!learned.positive.school || !learned.positive.painting) throw new Error("Relevant contractor terms were not learned");
if (!learned.negative.highway || !learned.negative.bridge) throw new Error("Irrelevant contractor terms were not learned");
