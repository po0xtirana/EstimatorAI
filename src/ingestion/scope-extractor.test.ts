import { extractScopeFromText } from "./scope-extractor";

const result = extractScopeFromText("Paint 1,200 m2 of walls and install 300 m2 drywall.");
if (result.length !== 2 || result[0].taskKey !== "paint-walls" || result[1].taskKey !== "drywall-install") throw new Error("scope extraction failed");
if (result[0].quantity !== 1200 || result[1].unit !== "m2") throw new Error("scope quantities failed");
