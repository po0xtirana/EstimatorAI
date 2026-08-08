import { getTradeTemplate } from "./trade-templates";

const renovation = getTradeTemplate("general-renovation");
if (!renovation) throw new Error("Renovation template is missing");
const required = ["site-protection", "selective-demolition", "drywall-install", "acoustic-ceiling", "paint-walls", "commercial-flooring", "doors-hardware", "millwork", "minor-mechanical", "minor-electrical", "mobilization-supervision", "closeout"];
for (const task of required) if (!renovation.assemblies.some((assembly) => assembly.taskKey === task)) throw new Error(`Renovation template is missing ${task}`);
if (renovation.crews.length < 3) throw new Error("Renovation template must offer multiple feasible crew formations");
