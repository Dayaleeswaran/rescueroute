/**
 * @module allergens
 * Conservative allergen conflict detection for food rescue operations.
 * Uses label equivalences — not an ingredient or food-safety inference engine.
 * A human coordinator must verify every allergen declaration before dispatch.
 */

// Conservative label equivalences, not an ingredient or food-safety inference.
const groups = [
  ["milk", "dairy", "whey", "casein"],
  ["egg", "eggs"],
  ["gluten", "wheat", "barley", "rye"],
  ["soy", "soya", "soybean", "soybeans"],
  [
    "nuts",
    "tree nuts",
    "peanut",
    "peanuts",
    "groundnut",
    "groundnuts",
    "almond",
    "almonds",
    "cashew",
    "cashews",
    "walnut",
    "walnuts",
    "hazelnut",
    "hazelnuts",
  ],
  ["sesame", "sesame seeds"],
  ["shellfish", "crustaceans", "shrimp", "prawn", "prawns", "crab", "lobster"],
  ["sulfites", "sulphites"],
];
const normalise = (value) => value.trim().toLowerCase().replace(/\s+/g, " ");
function key(value) {
  const name = normalise(value);
  return groups.find((group) => group.includes(name))?.[0] || name;
}
/**
 * Returns true when any declared allergen in a food offer conflicts with any
 * allergen excluded by a recipient request, using conservative label equivalences.
 * @param {string[]} declared - Allergens declared by the food donor.
 * @param {string[]} excluded - Allergens excluded by the recipient.
 * @returns {boolean} True if at least one allergen conflict exists.
 */
export const hasAllergenConflict = (declared, excluded) =>
  declared.some((a) => excluded.some((e) => key(a) === key(e)));
